import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const envelopeSchema = z.object({
  event: z.string().min(1),
  data: z.unknown()
}).passthrough();

const successfulChargeSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().nonnegative()]),
  reference: z.string().trim().min(1)
}).passthrough();

export type ParsedPaystackWebhook =
  | { kind: 'ignored'; eventType: string }
  | {
      kind: 'charge_success';
      eventKey: string;
      eventType: 'charge.success';
      providerTransactionId: string;
      reference: string;
      payload: unknown;
    };

export function validPaystackSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const actualBuffer = Buffer.from(signature.toLowerCase(), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function parsePaystackWebhook(payload: unknown): ParsedPaystackWebhook | null {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return null;
  if (envelope.data.event !== 'charge.success') {
    return { kind: 'ignored', eventType: envelope.data.event };
  }

  const charge = successfulChargeSchema.safeParse(envelope.data.data);
  if (!charge.success) return null;
  if (!/^GDG-\d{8}-[A-Z2-9]{8}$/.test(charge.data.reference)) {
    return { kind: 'ignored', eventType: envelope.data.event };
  }
  const providerTransactionId = String(charge.data.id);
  return {
    kind: 'charge_success',
    eventKey: `paystack:charge.success:${providerTransactionId}`,
    eventType: 'charge.success',
    providerTransactionId,
    reference: charge.data.reference,
    payload: {
      event: 'charge.success',
      data: { id: providerTransactionId, reference: charge.data.reference }
    }
  };
}
