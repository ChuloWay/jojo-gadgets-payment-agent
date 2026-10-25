import { z } from 'zod';
import type { PaystackInitializeData, PaystackVerifyData, ProviderAttempt } from '../domain/types.js';

const initializeSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().url(),
    access_code: z.string().min(1),
    reference: z.string().min(1)
  })
});

const verifySchema = z.object({
  status: z.literal(true),
  data: z.object({
    status: z.string().min(1),
    reference: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().min(1),
    domain: z.string().optional(),
    paid_at: z.string().nullable().optional()
  })
});

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly payload: unknown,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export class ProviderResponseError extends Error {
  constructor(message: string, readonly payload: unknown) {
    super(message);
  }
}

export type AttemptRecorder = (attempt: ProviderAttempt) => Promise<void>;

export interface PaymentProvider {
  initialize(input: {
    email: string;
    amountKobo: number;
    reference: string;
  }, recordAttempt: AttemptRecorder): Promise<PaystackInitializeData>;
  verify(reference: string, recordAttempt: AttemptRecorder): Promise<PaystackVerifyData>;
}

export class PaystackClient implements PaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs = 8_000
  ) {}

  async initialize(
    input: { email: string; amountKobo: number; reference: string },
    recordAttempt: AttemptRecorder
  ): Promise<PaystackInitializeData> {
    const response = await this.request(
      '/transaction/initialize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          amount: String(input.amountKobo),
          reference: input.reference,
          currency: 'NGN'
        })
      },
      1,
      recordAttempt
    );
    const parsed = initializeSchema.safeParse(response);
    if (!parsed.success) throw new ProviderResponseError('Malformed Paystack initialize response', response);
    return {
      authorizationUrl: parsed.data.data.authorization_url,
      accessCode: parsed.data.data.access_code,
      reference: parsed.data.data.reference
    };
  }

  async verify(reference: string, recordAttempt: AttemptRecorder): Promise<PaystackVerifyData> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await this.request(
          `/transaction/verify/${encodeURIComponent(reference)}`,
          { method: 'GET' },
          attempt,
          recordAttempt
        );
        const parsed = verifySchema.safeParse(response);
        if (!parsed.success) throw new ProviderResponseError('Malformed Paystack verify response', response);
        return {
          status: parsed.data.data.status,
          reference: parsed.data.data.reference,
          amount: parsed.data.data.amount,
          currency: parsed.data.data.currency,
          ...(parsed.data.data.domain === undefined ? {} : { domain: parsed.data.data.domain }),
          ...(parsed.data.data.paid_at === undefined ? {} : { paidAt: parsed.data.data.paid_at })
        };
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ProviderHttpError ? error.retryable : error instanceof TypeError;
        if (!retryable || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw lastError;
  }

  private async request(
    path: string,
    init: RequestInit,
    attempt: number,
    recordAttempt: AttemptRecorder
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.secretKey}`, ...(init.headers ?? {}) },
        signal: controller.signal
      });
    } catch (error) {
      const payload = { error: error instanceof Error ? error.name : 'network_error' };
      await recordAttempt({ attempt, payload });
      throw new TypeError('Paystack request failed');
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { malformed_body: text.slice(0, 500) };
      }
    }
    await recordAttempt({ attempt, httpStatus: response.status, payload });
    if (!response.ok) {
      throw new ProviderHttpError(
        'Paystack returned a non-success response',
        response.status,
        payload,
        response.status >= 500
      );
    }
    return payload;
  }
}
