import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ensureSeeded, seed } from '../src/db/seed.js';
import { createPool } from '../src/db/pool.js';
import type { PaystackInitializeData, PaystackVerifyData } from '../src/domain/types.js';
import type { AttemptRecorder, PaymentProvider } from '../src/paystack/client.js';
import { CommerceService } from '../src/services/commerce-service.js';
import { createMcpServer } from '../src/mcp/server.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

class FakeProvider implements PaymentProvider {
  initializeCalls = 0;
  verifyCalls = 0;
  initializeError: Error | undefined;
  verifyByReference = new Map<string, PaystackVerifyData>();

  async initialize(
    input: { email: string; amountKobo: number; reference: string },
    recordAttempt: AttemptRecorder
  ): Promise<PaystackInitializeData> {
    this.initializeCalls += 1;
    await recordAttempt({ attempt: 1, httpStatus: 200, payload: { status: true } });
    if (this.initializeError) throw this.initializeError;
    return {
      authorizationUrl: `https://checkout.paystack.test/${input.reference}`,
      accessCode: `access-${input.reference}`,
      reference: input.reference
    };
  }

  async verify(reference: string, recordAttempt: AttemptRecorder): Promise<PaystackVerifyData> {
    this.verifyCalls += 1;
    await recordAttempt({ attempt: 1, httpStatus: 200, payload: { status: true } });
    const result = this.verifyByReference.get(reference);
    if (!result) throw new Error(`No fake verification configured for ${reference}`);
    return result;
  }
}

describeDatabase('CommerceService with PostgreSQL', () => {
  const pool = createPool(testDatabaseUrl!);
  const logger = pino({ level: 'silent' });

  beforeEach(async () => {
    await seed(testDatabaseUrl!);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function ps5Quote(service: CommerceService) {
    const result = await service.checkStock({ query: 'PS5' });
    expect(result.status).toBe('ok');
    const match = (result.matches as Array<{ sku: string; quote_token: string }>)[0]!;
    return match;
  }

  it('ensures missing demo inventory without resetting existing stock', async () => {
    await pool.query('TRUNCATE owner_alerts, payment_events, orders, quotes, skus RESTART IDENTITY CASCADE');

    await ensureSeeded(testDatabaseUrl!);
    const initial = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM skus');
    expect(initial.rows[0]?.count).toBe('6');

    await pool.query('UPDATE skus SET qty_available = 0 WHERE sku = $1', ['PS5-DISC-NEW']);
    await ensureSeeded(testDatabaseUrl!);
    const preserved = await pool.query<{ qty_available: number }>(
      'SELECT qty_available FROM skus WHERE sku = $1',
      ['PS5-DISC-NEW']
    );
    expect(preserved.rows[0]?.qty_available).toBe(0);
  });

  it('creates one checkout and reuses it for a duplicate request', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);

    const first = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000001',
      customerName: 'Test Buyer'
    });
    const second = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000001',
      customerName: 'Test Buyer'
    });

    expect(first.status).toBe('created');
    expect(second.status).toBe('existing_pending');
    expect(second.reference).toBe(first.reference);
    expect(provider.initializeCalls).toBe(1);

    const stock = await pool.query('SELECT qty_available FROM skus WHERE sku = $1', [quote.sku]);
    expect(stock.rows[0]).toMatchObject({ qty_available: 1 });
  });

  it('allows concurrent checkout windows without reserving the last unit', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);

    const results = await Promise.all([
      service.createPayment({ sku: quote.sku, quoteToken: quote.quote_token, customerPhone: '+2348000000011', customerName: 'Buyer One' }),
      service.createPayment({ sku: quote.sku, quoteToken: quote.quote_token, customerPhone: '+2348000000022', customerName: 'Buyer Two' })
    ]);

    expect(results.map((result) => result.status)).toEqual(['created', 'created']);
    expect(provider.initializeCalls).toBe(2);
    const stock = await pool.query('SELECT qty_available FROM skus WHERE sku = $1', [quote.sku]);
    expect(stock.rows[0]).toMatchObject({ qty_available: 1 });
  });

  it('retains and reuses an initializing order after an ambiguous provider failure', async () => {
    const provider = new FakeProvider();
    provider.initializeError = new TypeError('connection closed after dispatch');
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const input = {
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000077',
      customerName: 'Uncertain Buyer'
    };

    const first = await service.createPayment(input);
    const second = await service.createPayment(input);

    expect(first.status).toBe('payment_provider_error');
    expect(second.status).toBe('payment_provider_error');
    expect(second.reference).toBe(first.reference);
    expect(provider.initializeCalls).toBe(1);
    const stock = await pool.query('SELECT qty_available FROM skus WHERE sku = $1', [quote.sku]);
    expect(stock.rows[0]).toMatchObject({ qty_available: 1 });
  });

  it('marks a successful payment once when verification is repeated', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const created = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000033',
      customerName: 'Paid Buyer'
    });
    const reference = created.reference as string;
    provider.verifyByReference.set(reference, {
      status: 'success', reference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });

    const first = await service.verifyPayment(reference);
    const second = await service.verifyPayment(reference);

    expect(first).toMatchObject({ status: 'paid', already_confirmed: false });
    expect(second).toMatchObject({ status: 'paid', already_confirmed: true });
    expect(provider.verifyCalls).toBe(1);
    const stock = await pool.query('SELECT qty_available FROM skus WHERE sku = $1', [quote.sku]);
    expect(stock.rows[0]).toMatchObject({ qty_available: 0 });
  });

  it('does not finalize inventory twice under simultaneous verification', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const created = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000088',
      customerName: 'Concurrent Buyer'
    });
    const reference = created.reference as string;
    provider.verifyByReference.set(reference, {
      status: 'success', reference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });

    const results = await Promise.all([service.verifyPayment(reference), service.verifyPayment(reference)]);

    expect(results.every((result) => result.status === 'paid')).toBe(true);
    const stock = await pool.query('SELECT qty_available FROM skus WHERE sku = $1', [quote.sku]);
    expect(stock.rows[0]).toMatchObject({ qty_available: 0 });
    const paidEvents = await pool.query(
      "SELECT count(*)::int AS count FROM payment_events WHERE order_reference = $1 AND event_type = 'ORDER_PAID'",
      [reference]
    );
    expect(paidEvents.rows[0]?.count).toBe(1);
  });

  it('allocates the last unit to only one of two successfully paying customers', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const [first, second] = await Promise.all([
      service.createPayment({ sku: quote.sku, quoteToken: quote.quote_token, customerPhone: '+2348000000091', customerName: 'First Payer' }),
      service.createPayment({ sku: quote.sku, quoteToken: quote.quote_token, customerPhone: '+2348000000092', customerName: 'Second Payer' })
    ]);
    const firstReference = first.reference as string;
    const secondReference = second.reference as string;
    provider.verifyByReference.set(firstReference, {
      status: 'success', reference: firstReference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });
    provider.verifyByReference.set(secondReference, {
      status: 'success', reference: secondReference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });

    const results = await Promise.all([
      service.verifyPayment(firstReference),
      service.verifyPayment(secondReference)
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['paid', 'paid_needs_owner']);
    const stock = await pool.query('SELECT qty_available FROM skus WHERE sku = $1', [quote.sku]);
    expect(stock.rows[0]).toMatchObject({ qty_available: 0 });
  });

  it('records an underpayment without allocating stock', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const created = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000044',
      customerName: 'Short Buyer'
    });
    const reference = created.reference as string;
    provider.verifyByReference.set(reference, {
      status: 'success', reference, amount: 70_000_000, currency: 'NGN', domain: 'test'
    });

    const result = await service.verifyPayment(reference);

    expect(result).toMatchObject({ status: 'underpaid', shortfall_ngn: 80_000, payment_window_expired: false });
    const order = await pool.query(
      `SELECT o.status, s.qty_available FROM orders o JOIN skus s ON s.sku = o.sku WHERE o.reference = $1`,
      [reference]
    );
    expect(order.rows[0]).toMatchObject({ status: 'UNDERPAID', qty_available: 1 });
  });

  it('routes a late successful payment to owner review when stock was reallocated', async () => {
    let current = new Date('2026-10-25T12:00:00.000Z');
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger, () => current);
    const firstQuote = await ps5Quote(service);
    const first = await service.createPayment({
      sku: firstQuote.sku,
      quoteToken: firstQuote.quote_token,
      customerPhone: '+2348000000055',
      customerName: 'Late Buyer'
    });
    const secondQuote = await ps5Quote(service);
    const second = await service.createPayment({
      sku: secondQuote.sku,
      quoteToken: secondQuote.quote_token,
      customerPhone: '+2348000000066',
      customerName: 'Current Buyer'
    });
    expect(second.status).toBe('created');

    const currentReference = second.reference as string;
    provider.verifyByReference.set(currentReference, {
      status: 'success', reference: currentReference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });
    expect((await service.verifyPayment(currentReference)).status).toBe('paid');

    current = new Date('2026-10-25T12:31:00.000Z');
    expect(await service.sweepExpired()).toBe(1);

    const lateReference = first.reference as string;
    provider.verifyByReference.set(lateReference, {
      status: 'success', reference: lateReference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });
    const result = await service.verifyPayment(lateReference);
    const repeated = await service.verifyPayment(lateReference);

    expect(result.status).toBe('paid_needs_owner');
    expect(repeated.status).toBe('paid_needs_owner');
    expect(provider.verifyCalls).toBe(2);
    const order = await pool.query('SELECT status FROM orders WHERE reference = $1', [lateReference]);
    expect(order.rows[0]?.status).toBe('PAID_NEEDS_OWNER');
  });

  it('records a pickup preference only after payment and remains idempotent', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const created = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000101',
      customerName: 'Pickup Buyer'
    });
    const reference = created.reference as string;

    expect(await service.captureFulfillmentPreference({
      reference,
      method: 'pickup',
      preferredTime: 'Tomorrow around 2 PM'
    })).toMatchObject({ status: 'payment_not_confirmed' });

    provider.verifyByReference.set(reference, {
      status: 'success', reference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });
    await service.verifyPayment(reference);

    const first = await service.captureFulfillmentPreference({
      reference,
      method: 'pickup',
      preferredTime: 'Tomorrow around 2 PM'
    });
    const repeated = await service.captureFulfillmentPreference({
      reference,
      method: 'pickup',
      preferredTime: 'Tomorrow around 2 PM'
    });

    expect(first).toMatchObject({ status: 'recorded_pending_owner_confirmation', already_recorded: false });
    expect(repeated).toMatchObject({ status: 'recorded_pending_owner_confirmation', already_recorded: true });
    const stored = await pool.query('SELECT * FROM order_fulfillments WHERE order_reference = $1', [reference]);
    expect(stored.rows[0]).toMatchObject({
      method: 'pickup',
      preferred_time: 'Tomorrow around 2 PM',
      contact_phone: '+2348000000101',
      status: 'PENDING_OWNER_CONFIRMATION'
    });
    const events = await pool.query(
      "SELECT count(*)::int AS count FROM payment_events WHERE order_reference = $1 AND event_type = 'FULFILLMENT_PREFERENCE_RECORDED'",
      [reference]
    );
    expect(events.rows[0]?.count).toBe(1);
  });

  it('validates and records a delivery request without promising dispatch', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const quote = await ps5Quote(service);
    const created = await service.createPayment({
      sku: quote.sku,
      quoteToken: quote.quote_token,
      customerPhone: '+2348000000102',
      customerName: 'Delivery Buyer'
    });
    const reference = created.reference as string;
    provider.verifyByReference.set(reference, {
      status: 'success', reference, amount: 78_000_000, currency: 'NGN', domain: 'test'
    });
    await service.verifyPayment(reference);

    expect(await service.captureFulfillmentPreference({ reference, method: 'delivery_request' }))
      .toMatchObject({ status: 'invalid_request' });

    const result = await service.captureFulfillmentPreference({
      reference,
      method: 'delivery_request',
      deliveryArea: 'Ikeja',
      landmark: 'Demo landmark',
      recipientName: 'Synthetic Customer',
      contactPhone: '07000000000'
    });

    expect(result).toMatchObject({
      status: 'recorded_pending_owner_confirmation',
      method: 'delivery_request',
      delivery_area: 'Ikeja'
    });
    expect(result.message_for_agent).toContain('Do not say delivery is booked');
  });

  it('publishes exactly the four intended MCP tools with their schemas', async () => {
    const provider = new FakeProvider();
    const service = new CommerceService(pool, provider, 30, logger);
    const server = createMcpServer(service);
    const client = new Client({ name: 'contract-test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const discovered = await client.listTools();
      expect(discovered.tools.map((tool) => tool.name).sort()).toEqual([
        'capture_fulfillment_preference',
        'check_stock_and_quote',
        'create_payment',
        'verify_payment'
      ]);
      const createTool = discovered.tools.find((tool) => tool.name === 'create_payment');
      expect(createTool?.inputSchema.required).toEqual(
        expect.arrayContaining(['sku', 'quote_token', 'customer_phone', 'customer_name'])
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
