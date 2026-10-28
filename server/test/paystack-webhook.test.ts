import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePaystackWebhook, validPaystackSignature } from '../src/paystack/webhook.js';

const secret = 'sk_test_webhook_signature_secret';

describe('Paystack webhook validation', () => {
  it('accepts only the HMAC-SHA512 signature of the exact raw body', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 42 } }));
    const signature = createHmac('sha512', secret).update(raw).digest('hex');

    expect(validPaystackSignature(raw, signature, secret)).toBe(true);
    expect(validPaystackSignature(Buffer.from(`${raw.toString()} `), signature, secret)).toBe(false);
    expect(validPaystackSignature(raw, undefined, secret)).toBe(false);
  });

  it('extracts the provider transaction ID and exact internal order reference', () => {
    const payload = {
      event: 'charge.success',
      data: { id: 987654321, reference: 'GDG-20261028-ABCDEFGH', amount: 52_000_000 }
    };

    expect(parsePaystackWebhook(payload)).toMatchObject({
      kind: 'charge_success',
      eventKey: 'paystack:charge.success:987654321',
      providerTransactionId: '987654321',
      reference: 'GDG-20261028-ABCDEFGH',
      payload: {
        event: 'charge.success',
        data: { id: '987654321', reference: 'GDG-20261028-ABCDEFGH' }
      }
    });
  });

  it('acknowledges unrelated signed event types without treating them as payments', () => {
    expect(parsePaystackWebhook({ event: 'transfer.success', data: { id: 12 } }))
      .toEqual({ kind: 'ignored', eventType: 'transfer.success' });
  });

  it('ignores successful charges that belong to another Paystack integration', () => {
    expect(parsePaystackWebhook({ event: 'charge.success', data: { id: 12, reference: 'someone-else' } }))
      .toEqual({ kind: 'ignored', eventType: 'charge.success' });
  });
});
