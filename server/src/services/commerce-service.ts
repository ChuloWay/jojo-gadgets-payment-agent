import { randomBytes, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { DatabaseClient, DatabasePool } from '../db/pool.js';
import { formatNaira, koboToNaira } from '../domain/money.js';
import type { PaystackVerifyData, ProviderAttempt, SkuCondition } from '../domain/types.js';
import {
  ProviderHttpError,
  ProviderResponseError,
  type PaymentProvider
} from '../paystack/client.js';

const ACTIVE_PAYMENT_STATUSES = ['INITIALIZING', 'PENDING', 'UNDERPAID'] as const;
const WAITING_PROVIDER_STATUSES = new Set(['abandoned', 'ongoing', 'pending', 'processing', 'queued']);
const FAILED_PROVIDER_STATUSES = new Set(['failed', 'reversed']);
const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type OrderRow = {
  reference: string;
  sku: string;
  customer_phone: string;
  customer_name: string;
  amount_expected_kobo: string;
  amount_paid_kobo: string | null;
  status: string;
  payment_expires_at: Date;
  authorization_url: string | null;
  paystack_access_code: string | null;
  created_at: Date;
  paid_at: Date | null;
  name?: string;
  condition?: string;
  variant?: string;
};

export type ToolResult = Record<string, unknown> & { status: string; message_for_agent: string };

function integer(value: string | number | bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Database amount is outside the safe integer range');
  return parsed;
}

function referenceFor(date = new Date()): string {
  let random = '';
  for (const byte of randomBytes(8)) random += BASE32[byte % BASE32.length];
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `GDG-${day}-${random}`;
}

function quoteToken(): string {
  return `quote_${randomUUID()}`;
}

function customerEmail(phone: string): string {
  const local = phone.replace(/\D/g, '') || randomUUID().replaceAll('-', '');
  return `${local}@orders.example.com`;
}

export class CommerceService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly provider: PaymentProvider,
    private readonly paymentWindowMinutes: number,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async checkStock(input: {
    query?: string | undefined;
    sku?: string | undefined;
    condition?: SkuCondition | undefined;
  }): Promise<ToolResult> {
    const query = input.query?.trim();
    const sku = input.sku?.trim();
    if (!query && !sku) {
      return { status: 'invalid_request', message_for_agent: 'Provide a product query or SKU.' };
    }

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (sku) {
      values.push(sku.toUpperCase());
      conditions.push(`sku = $${values.length}`);
    } else if (query) {
      values.push(`%${query}%`);
      conditions.push(`(name ILIKE $${values.length} OR category ILIKE $${values.length} OR variant ILIKE $${values.length} OR sku ILIKE $${values.length})`);
    }
    if (input.condition) {
      values.push(input.condition);
      conditions.push(`condition = $${values.length}`);
    }

    const result = await this.pool.query<{
      sku: string;
      name: string;
      condition: string;
      variant: string;
      price_kobo: string;
      qty_available: number;
    }>(
      `SELECT sku, name, condition, variant, price_kobo, qty_available
       FROM skus WHERE ${conditions.join(' AND ')}
       ORDER BY name, variant LIMIT 10`,
      values
    );
    if (result.rowCount === 0) {
      return { status: 'no_match', matches: [], message_for_agent: 'No matching item was found in the live stock list.' };
    }

    const expiresAt = new Date(this.now().getTime() + 10 * 60_000);
    const matches = [];
    for (const row of result.rows) {
      const token = quoteToken();
      await this.pool.query(
        'INSERT INTO quotes(token, sku, price_kobo, expires_at) VALUES ($1, $2, $3, $4)',
        [token, row.sku, row.price_kobo, expiresAt]
      );
      matches.push({
        sku: row.sku,
        name: row.name,
        condition: row.condition,
        variant: row.variant,
        price_ngn: koboToNaira(row.price_kobo),
        available: row.qty_available,
        quote_token: token,
        quote_expires_at: expiresAt.toISOString()
      });
    }
    return {
      status: 'ok',
      matches,
      message_for_agent: `${matches.length} match${matches.length === 1 ? '' : 'es'}. Confirm the exact condition, variant, and total before creating payment; pass back the selected quote token.`
    };
  }

  async createPayment(input: {
    sku: string;
    quoteToken: string;
    customerPhone: string;
    customerName: string;
  }): Promise<ToolResult> {
    const now = this.now();
    const client = await this.pool.connect();
    let order: OrderRow;
    let item: { name: string; condition: string; variant: string };
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.customerPhone}:${input.sku}`
      ]);

      const quote = await client.query<{
        token: string;
        sku: string;
        price_kobo: string;
        expires_at: Date;
        name: string;
        condition: string;
        variant: string;
        current_price_kobo: string;
        qty_available: number;
      }>(
        `SELECT q.token, q.sku, q.price_kobo, q.expires_at,
                s.name, s.condition, s.variant, s.price_kobo AS current_price_kobo,
                s.qty_available
         FROM quotes q JOIN skus s ON s.sku = q.sku
         WHERE q.token = $1 AND q.sku = $2 FOR UPDATE OF q, s`,
        [input.quoteToken, input.sku]
      );
      const quoteRow = quote.rows[0];
      if (!quoteRow || quoteRow.expires_at <= now || quoteRow.price_kobo !== quoteRow.current_price_kobo) {
        await client.query('ROLLBACK');
        return {
          status: 'requote_required',
          message_for_agent: 'The quote is missing, expired, or the live price changed. Check stock again and reconfirm the total.'
        };
      }
      item = { name: quoteRow.name, condition: quoteRow.condition, variant: quoteRow.variant };

      if (quoteRow.qty_available < 1) {
        await client.query('ROLLBACK');
        return { status: 'out_of_stock', message_for_agent: 'That item is no longer available. Offer another variant or owner review.' };
      }

      const existing = await client.query<OrderRow>(
        `SELECT * FROM orders
         WHERE customer_phone = $1 AND sku = $2 AND status = ANY($3::text[])
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [input.customerPhone, input.sku, [...ACTIVE_PAYMENT_STATUSES]]
      );
      const active = existing.rows[0];
      if (active && active.payment_expires_at > now) {
        await client.query('COMMIT');
        return this.paymentCreationResult(active, item, active.authorization_url ? 'existing_pending' : 'payment_provider_error');
      }
      if (active) {
        await client.query(
          `UPDATE orders SET status = 'EXPIRED', updated_at = now()
           WHERE reference = $1 AND status = ANY($2::text[])`,
          [active.reference, [...ACTIVE_PAYMENT_STATUSES]]
        );
        await this.event(client, active.reference, 'PAYMENT_WINDOW_EXPIRED', {});
      }

      const reference = referenceFor(now);
      const paymentExpiresAt = new Date(now.getTime() + this.paymentWindowMinutes * 60_000);
      const inserted = await client.query<OrderRow>(
        `INSERT INTO orders (
           reference, sku, quote_token, customer_phone, customer_name, customer_email,
           amount_expected_kobo, status, payment_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'INITIALIZING', $8)
         RETURNING *`,
        [
          reference,
          input.sku,
          input.quoteToken,
          input.customerPhone,
          input.customerName,
          customerEmail(input.customerPhone),
          quoteRow.price_kobo,
          paymentExpiresAt
        ]
      );
      order = inserted.rows[0]!;
      await this.event(client, reference, 'ORDER_INITIALIZING', { payment_expires_at: paymentExpiresAt.toISOString() });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      const initialized = await this.provider.initialize(
        {
          email: customerEmail(input.customerPhone),
          amountKobo: integer(order.amount_expected_kobo),
          reference: order.reference
        },
        async (attempt) => this.recordProviderAttempt(order.reference, 'PAYSTACK_INITIALIZE', attempt, 'initialize_attempts')
      );
      if (initialized.reference !== order.reference) {
        throw new ProviderResponseError('Paystack initialize reference did not match the order', initialized);
      }
      const updated = await this.pool.query<OrderRow>(
        `UPDATE orders SET status = 'PENDING', authorization_url = $2, paystack_access_code = $3, updated_at = now()
         WHERE reference = $1 AND status = 'INITIALIZING' RETURNING *`,
        [order.reference, initialized.authorizationUrl, initialized.accessCode]
      );
      await this.event(this.pool, order.reference, 'PAYMENT_LINK_CREATED', { authorization_url: initialized.authorizationUrl });
      return this.paymentCreationResult(updated.rows[0] ?? order, item, 'created');
    } catch (error) {
      const definitelyRejected = error instanceof ProviderHttpError && !error.retryable;
      if (definitelyRejected) {
        const failureClient = await this.pool.connect();
        try {
          await failureClient.query('BEGIN');
          await failureClient.query(
            `UPDATE orders SET status = 'FAILED', updated_at = now()
             WHERE reference = $1 AND status = 'INITIALIZING'`,
            [order.reference]
          );
          await this.event(failureClient, order.reference, 'PAYMENT_INITIALIZE_REJECTED', { reason: 'provider_4xx' });
          await failureClient.query('COMMIT');
        } catch (failure) {
          await failureClient.query('ROLLBACK');
          throw failure;
        } finally {
          failureClient.release();
        }
      } else {
        await this.alert(order.reference, 'Payment initialization outcome is ambiguous and needs reconciliation');
      }
      return {
        status: 'payment_provider_error',
        reference: order.reference,
        payment_expires_at: order.payment_expires_at.toISOString(),
        message_for_agent: definitelyRejected
          ? 'The payment provider rejected initialization. Do not claim a payment link exists.'
          : 'The payment provider outcome is uncertain. Keep the reference, do not create another order, and say the case was flagged for owner review.'
      };
    }
  }

  async verifyPayment(reference: string): Promise<ToolResult> {
    const initial = await this.orderWithItem(reference);
    if (!initial) return { status: 'unknown_reference', message_for_agent: 'No order has that reference. Ask the customer to check it.' };
    if (initial.status === 'PAID') return this.paidResult(initial, true);
    if (initial.status === 'PAID_NEEDS_OWNER') {
      return {
        status: 'paid_needs_owner',
        reference,
        paid_ngn: koboToNaira(initial.amount_paid_kobo ?? initial.amount_expected_kobo),
        message_for_agent: 'Payment was already verified, but stock was unavailable when allocation was attempted. Say it remains flagged for owner review; do not promise a refund.'
      };
    }

    let verified: PaystackVerifyData;
    try {
      verified = await this.provider.verify(
        reference,
        async (attempt) => this.recordProviderAttempt(reference, 'PAYSTACK_VERIFY', attempt, 'verify_attempts')
      );
    } catch (error) {
      if (error instanceof ProviderHttpError && (error.httpStatus === 400 || error.httpStatus === 404)) {
        return this.applyNotPaid(reference);
      }
      await this.alert(reference, 'Paystack verification unavailable or malformed after retry policy');
      return {
        status: 'verification_unavailable',
        reference,
        message_for_agent: 'The payment check is taking longer than usual. Do not confirm or deny payment; say the case was flagged for owner review.'
      };
    }

    if (
      verified.reference !== reference ||
      verified.currency !== 'NGN' ||
      (verified.domain !== undefined && verified.domain !== 'test')
    ) {
      await this.alert(reference, 'Verification identity, currency, or test-domain validation failed');
      return {
        status: 'verification_unavailable',
        reference,
        message_for_agent: 'The provider response could not be safely matched to this test order. Do not confirm payment; say the case was flagged for owner review.'
      };
    }

    if (verified.status === 'success') return this.applySuccessfulPayment(reference, verified);
    if (WAITING_PROVIDER_STATUSES.has(verified.status)) return this.applyNotPaid(reference);
    if (FAILED_PROVIDER_STATUSES.has(verified.status)) return this.applyFailedPayment(reference, verified.status);

    await this.alert(reference, `Unknown Paystack payment status: ${verified.status}`);
    return {
      status: 'verification_unavailable',
      reference,
      message_for_agent: 'The provider returned an unfamiliar status. Do not infer payment; say the case was flagged for owner review.'
    };
  }

  async enqueuePaystackWebhook(input: {
    eventKey: string;
    eventType: 'charge.success';
    providerTransactionId: string;
    reference: string;
    payload: unknown;
  }): Promise<boolean> {
    const inserted = await this.pool.query(
      `INSERT INTO paystack_webhook_events (
         event_key, event_type, provider_transaction_id, order_reference, payload, status
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'RECEIVED')
       ON CONFLICT (event_key) DO NOTHING`,
      [input.eventKey, input.eventType, input.providerTransactionId, input.reference, JSON.stringify(input.payload)]
    );
    return inserted.rowCount === 1;
  }

  async processPendingPaystackWebhooks(limit = 25): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const client = await this.pool.connect();
    let claimed: Array<{ event_key: string; order_reference: string; attempts: number }> = [];
    try {
      await client.query('BEGIN');
      const result = await client.query<{ event_key: string; order_reference: string; attempts: number }>(
        `WITH claimable AS (
           SELECT event_key
           FROM paystack_webhook_events
           WHERE attempts < 10
             AND (
               (status IN ('RECEIVED', 'FAILED') AND next_attempt_at <= now())
               OR (status = 'PROCESSING' AND updated_at <= now() - interval '5 minutes')
             )
           ORDER BY received_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE paystack_webhook_events AS event
         SET status = 'PROCESSING', attempts = event.attempts + 1, updated_at = now()
         FROM claimable
         WHERE event.event_key = claimable.event_key
         RETURNING event.event_key, event.order_reference, event.attempts`,
        [boundedLimit]
      );
      claimed = result.rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    for (const event of claimed) {
      try {
        const result = await this.verifyPayment(event.order_reference);
        if (result.status === 'verification_unavailable') {
          throw new Error('Provider verification remained unavailable');
        }
        await this.pool.query(
          `UPDATE paystack_webhook_events
           SET status = $2, result_status = $3, last_error = NULL,
               processed_at = now(), updated_at = now()
           WHERE event_key = $1`,
          [event.event_key, result.status === 'unknown_reference' ? 'IGNORED' : 'PROCESSED', result.status]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown webhook processing failure';
        const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(event.attempts - 1, 7)));
        await this.pool.query(
          `UPDATE paystack_webhook_events
           SET status = 'FAILED', last_error = $2,
               next_attempt_at = now() + ($3 * interval '1 second'), updated_at = now()
           WHERE event_key = $1`,
          [event.event_key, message.slice(0, 500), delaySeconds]
        );
        this.logger.error({ error, eventKey: event.event_key, reference: event.order_reference }, 'Paystack webhook processing failed');
        if (event.attempts >= 10) {
          await this.alert(event.order_reference, 'Automatic Paystack webhook verification failed after retry policy');
        }
      }
    }
    return claimed.length;
  }

  async captureFulfillmentPreference(input: {
    reference: string;
    method: 'pickup' | 'delivery_request';
    preferredTime?: string | undefined;
    deliveryArea?: string | undefined;
    landmark?: string | undefined;
    recipientName?: string | undefined;
    contactPhone?: string | undefined;
  }): Promise<ToolResult> {
    const preferredTime = input.preferredTime?.trim() || null;
    const deliveryArea = input.deliveryArea?.trim() || null;
    const landmark = input.landmark?.trim() || null;
    const recipientName = input.recipientName?.trim() || null;
    const suppliedPhone = input.contactPhone?.trim() || null;

    if (input.method === 'pickup' && !preferredTime) {
      return {
        status: 'invalid_request',
        message_for_agent: 'Ask for the customer\'s preferred pickup date and approximate arrival time.'
      };
    }
    if (input.method === 'delivery_request' && (!deliveryArea || !recipientName || !suppliedPhone)) {
      return {
        status: 'invalid_request',
        message_for_agent: 'Ask for the delivery area, recipient name, and phone number to call. A landmark is optional.'
      };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query<OrderRow>(
        'SELECT * FROM orders WHERE reference = $1 FOR UPDATE',
        [input.reference]
      );
      const order = orderResult.rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        return {
          status: 'unknown_reference',
          message_for_agent: 'No order has that reference. Ask the customer to check it.'
        };
      }
      if (order.status !== 'PAID') {
        await client.query('ROLLBACK');
        return {
          status: 'payment_not_confirmed',
          reference: input.reference,
          message_for_agent: 'Fulfilment details can be recorded only after payment is verified and stock is allocated.'
        };
      }

      const contactPhone = suppliedPhone ?? order.customer_phone;
      const existing = await client.query<{
        method: string;
        preferred_time: string | null;
        delivery_area: string | null;
        landmark: string | null;
        recipient_name: string | null;
        contact_phone: string;
        status: string;
      }>('SELECT * FROM order_fulfillments WHERE order_reference = $1 FOR UPDATE', [input.reference]);
      const current = existing.rows[0];
      const unchanged = current
        && current.method === input.method
        && current.preferred_time === preferredTime
        && current.delivery_area === deliveryArea
        && current.landmark === landmark
        && current.recipient_name === recipientName
        && current.contact_phone === contactPhone;

      if (!unchanged) {
        await client.query(
          `INSERT INTO order_fulfillments (
             order_reference, method, preferred_time, delivery_area, landmark,
             recipient_name, contact_phone, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_OWNER_CONFIRMATION')
           ON CONFLICT (order_reference) DO UPDATE SET
             method = EXCLUDED.method,
             preferred_time = EXCLUDED.preferred_time,
             delivery_area = EXCLUDED.delivery_area,
             landmark = EXCLUDED.landmark,
             recipient_name = EXCLUDED.recipient_name,
             contact_phone = EXCLUDED.contact_phone,
             status = 'PENDING_OWNER_CONFIRMATION',
             updated_at = now()`,
          [input.reference, input.method, preferredTime, deliveryArea, landmark, recipientName, contactPhone]
        );
        await this.event(client, input.reference, current ? 'FULFILLMENT_PREFERENCE_UPDATED' : 'FULFILLMENT_PREFERENCE_RECORDED', {
          method: input.method,
          preferred_time: preferredTime,
          delivery_area: deliveryArea,
          landmark,
          recipient_name: recipientName,
          contact_phone: contactPhone
        });
        await this.insertAlert(
          client,
          input.reference,
          input.method === 'pickup'
            ? 'Pickup time preference requires owner confirmation'
            : 'Delivery request requires owner confirmation, pricing, and availability review'
        );
      }
      await client.query('COMMIT');

      return {
        status: 'recorded_pending_owner_confirmation',
        already_recorded: Boolean(unchanged),
        reference: input.reference,
        method: input.method,
        preferred_time: preferredTime,
        delivery_area: deliveryArea,
        landmark,
        recipient_name: recipientName,
        contact_phone: contactPhone,
        message_for_agent: input.method === 'pickup'
          ? 'Say the preferred pickup time was recorded for owner review. Uchenna needs to confirm the exact collection time and shop details before the customer comes; do not claim he was directly notified.'
          : 'Say the delivery request was recorded for owner review. Uchenna needs to confirm availability, cost, and timing before dispatch. Do not say delivery is booked or that he was directly notified.'
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async sweepExpired(limit = 100): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<OrderRow>(
        `SELECT * FROM orders
         WHERE status IN ('INITIALIZING', 'PENDING') AND payment_expires_at <= $1
         ORDER BY payment_expires_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [this.now(), limit]
      );
      for (const order of expired.rows) {
        await client.query(
          `UPDATE orders SET status = 'EXPIRED', updated_at = now() WHERE reference = $1`,
          [order.reference]
        );
        await this.event(client, order.reference, 'PAYMENT_WINDOW_EXPIRED', {});
      }
      await client.query('COMMIT');
      return expired.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applySuccessfulPayment(reference: string, verified: PaystackVerifyData): Promise<ToolResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<OrderRow & { name: string; condition: string; variant: string }>(
        `SELECT o.*, s.name, s.condition, s.variant FROM orders o JOIN skus s ON s.sku = o.sku
         WHERE o.reference = $1 FOR UPDATE OF o, s`,
        [reference]
      );
      const order = result.rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        return { status: 'unknown_reference', message_for_agent: 'No order has that reference.' };
      }
      if (order.status === 'PAID') {
        await client.query('COMMIT');
        return this.paidResult(order, true);
      }

      const expected = integer(order.amount_expected_kobo);
      const paymentWindowExpired = order.payment_expires_at <= this.now();
      if (verified.amount < expected) {
        await client.query(
          `UPDATE orders SET status = 'UNDERPAID', amount_paid_kobo = $2, last_verified_at = now(), updated_at = now()
           WHERE reference = $1`,
          [reference, verified.amount]
        );
        await this.event(client, reference, 'PAYMENT_UNDERPAID', { paid_kobo: verified.amount, expected_kobo: expected });
        await this.insertAlert(client, reference, paymentWindowExpired ? 'Underpayment received after the payment window expired' : 'Underpayment requires owner review');
        await client.query('COMMIT');
        return {
          status: 'underpaid',
          reference,
          paid_ngn: koboToNaira(verified.amount),
          expected_ngn: koboToNaira(expected),
          shortfall_ngn: koboToNaira(expected - verified.amount),
          payment_window_expired: paymentWindowExpired,
          message_for_agent: `State the ${formatNaira(expected - verified.amount)} shortfall and say it was flagged for owner review. Do not confirm the order as paid.`
        };
      }

      const allocated = await client.query(
        `UPDATE skus SET qty_available = qty_available - 1, updated_at = now()
         WHERE sku = $1 AND qty_available >= 1 RETURNING sku`,
        [order.sku]
      );
      const paidStatus: 'PAID' | 'PAID_NEEDS_OWNER' = allocated.rowCount === 1 ? 'PAID' : 'PAID_NEEDS_OWNER';

      await client.query(
        `UPDATE orders SET status = $2, amount_paid_kobo = $3,
          paid_at = now(), last_verified_at = now(), updated_at = now() WHERE reference = $1`,
        [reference, paidStatus, verified.amount]
      );
      await this.event(client, reference, paidStatus === 'PAID' ? 'ORDER_PAID' : 'PAID_WITHOUT_STOCK', { paid_kobo: verified.amount });
      if (paidStatus === 'PAID_NEEDS_OWNER') await this.insertAlert(client, reference, 'Payment succeeded but stock was unavailable at allocation time');
      await client.query('COMMIT');

      if (paidStatus === 'PAID_NEEDS_OWNER') {
        return {
          status: 'paid_needs_owner',
          reference,
          paid_ngn: koboToNaira(verified.amount),
          message_for_agent: 'Payment succeeded, but the item was unavailable when allocation was attempted. Apologise and say it was flagged for owner review; do not promise a refund.'
        };
      }
      return this.paidResult({ ...order, amount_paid_kobo: String(verified.amount), status: 'PAID', paid_at: this.now() }, false);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyNotPaid(reference: string): Promise<ToolResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<OrderRow>('SELECT * FROM orders WHERE reference = $1 FOR UPDATE', [reference]);
      const order = result.rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        return { status: 'unknown_reference', message_for_agent: 'No order has that reference.' };
      }
      if (order.status === 'PAID') {
        await client.query('COMMIT');
        const full = await this.orderWithItem(reference);
        return this.paidResult(full!, true);
      }
      if (order.status === 'UNDERPAID') {
        await client.query('COMMIT');
        return {
          status: 'underpaid',
          reference,
          message_for_agent: 'The payment is still short. Say it remains flagged for owner review and do not confirm the order as paid.'
        };
      }
      if (order.payment_expires_at <= this.now()) {
        await client.query(
          `UPDATE orders SET status = 'EXPIRED', updated_at = now() WHERE reference = $1`,
          [reference]
        );
        await this.event(client, reference, 'PAYMENT_WINDOW_EXPIRED', {});
        await client.query('COMMIT');
        return {
          status: 'expired',
          reference,
          message_for_agent: 'No successful payment was found before the payment window expired. Check live stock and create a fresh quote before offering another link.'
        };
      }
      await client.query('UPDATE orders SET last_verified_at = now(), updated_at = now() WHERE reference = $1', [reference]);
      await this.event(client, reference, 'PAYMENT_NOT_PAID_YET', {});
      await client.query('COMMIT');
      return {
        status: 'not_paid_yet',
        reference,
        authorization_url: order.authorization_url,
        payment_expires_at: order.payment_expires_at.toISOString(),
        message_for_agent: 'No successful payment exists on this reference yet. Resend the link when available and remind the customer that the payment window is time-limited and stock is allocated only after verification.'
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyFailedPayment(reference: string, providerStatus: string): Promise<ToolResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<OrderRow>('SELECT * FROM orders WHERE reference = $1 FOR UPDATE', [reference]);
      const order = result.rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        return { status: 'unknown_reference', message_for_agent: 'No order has that reference.' };
      }
      if (order.status === 'PAID') {
        await client.query('COMMIT');
        const full = await this.orderWithItem(reference);
        return this.paidResult(full!, true);
      }
      await client.query("UPDATE orders SET status = 'FAILED', updated_at = now() WHERE reference = $1", [reference]);
      await this.event(client, reference, 'PAYMENT_FAILED', { provider_status: providerStatus });
      await client.query('COMMIT');
      return { status: 'failed', reference, message_for_agent: 'The payment failed or was reversed. Offer to check stock and create a new payment.' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private paymentCreationResult(order: OrderRow, item: { name: string; condition: string; variant: string }, status: string): ToolResult {
    return {
      status,
      reference: order.reference,
      item: `${item.name} (${item.condition}, ${item.variant})`,
      amount_ngn: koboToNaira(order.amount_expected_kobo),
      authorization_url: order.authorization_url,
      payment_expires_at: order.payment_expires_at.toISOString(),
      message_for_agent: order.authorization_url
        ? `Send the checkout link and reference. State that the payment window ends at ${order.payment_expires_at.toISOString()}, stock is allocated only after verified payment, and the customer should say paid when done.`
        : 'The checkout outcome is unresolved. Keep this reference and say the case was flagged for owner review; do not create another order.'
    };
  }

  private paidResult(order: OrderRow, alreadyConfirmed: boolean): ToolResult {
    const amount = order.amount_paid_kobo ?? order.amount_expected_kobo;
    return {
      status: 'paid',
      already_confirmed: alreadyConfirmed,
      reference: order.reference,
      item: order.name ? `${order.name} (${order.condition}, ${order.variant})` : order.sku,
      amount_ngn: koboToNaira(amount),
      paid_at: order.paid_at?.toISOString() ?? null,
      message_for_agent: 'Payment is verified. Send a concise WhatsApp payment receipt with the item, amount, reference, payment status, and a thank-you. State that the default warranty is 3 months subject to confirmation for the unit, then ask whether the customer prefers shop pickup or wants Uchenna to review a delivery request. Do not describe it as a tax invoice.'
    };
  }

  private async orderWithItem(reference: string): Promise<OrderRow | undefined> {
    const result = await this.pool.query<OrderRow>(
      `SELECT o.*, s.name, s.condition, s.variant FROM orders o JOIN skus s ON s.sku = o.sku
       WHERE o.reference = $1`,
      [reference]
    );
    return result.rows[0];
  }

  private async recordProviderAttempt(
    reference: string,
    eventType: string,
    attempt: ProviderAttempt,
    counterColumn: 'verify_attempts' | 'initialize_attempts'
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE orders SET ${counterColumn} = ${counterColumn} + 1,
          last_verified_at = CASE WHEN $2 = 'verify_attempts' THEN now() ELSE last_verified_at END,
          updated_at = now() WHERE reference = $1`,
        [reference, counterColumn]
      );
      await this.event(client, reference, eventType, attempt.payload, attempt.httpStatus);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async alert(reference: string, reason: string): Promise<void> {
    await this.pool.query('INSERT INTO owner_alerts(order_reference, reason) VALUES ($1, $2)', [reference, reason]);
    this.logger.warn({ reference, reason }, 'owner review flagged');
  }

  private async insertAlert(client: DatabaseClient, reference: string, reason: string): Promise<void> {
    await client.query('INSERT INTO owner_alerts(order_reference, reason) VALUES ($1, $2)', [reference, reason]);
    this.logger.warn({ reference, reason }, 'owner review flagged');
  }

  private async event(
    executor: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    reference: string,
    eventType: string,
    payload: unknown,
    providerStatus?: number
  ): Promise<void> {
    await executor.query(
      `INSERT INTO payment_events(order_reference, event_type, provider_status, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [reference, eventType, providerStatus ?? null, JSON.stringify(payload ?? {})]
    );
  }
}
