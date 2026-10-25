import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaystackClient, ProviderHttpError, ProviderResponseError } from '../src/paystack/client.js';

const successfulVerify = {
  status: true,
  data: {
    status: 'success',
    reference: 'GDG-20261025-ABCDEFGH',
    amount: 78_000_000,
    currency: 'NGN',
    domain: 'test',
    paid_at: '2026-10-25T12:00:00.000Z'
  }
};

describe('PaystackClient retry and validation policy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries one 5xx response and records both attempts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: false }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successfulVerify), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const attempts: number[] = [];
    const client = new PaystackClient('sk_test_value', 'https://api.paystack.test');

    const result = await client.verify(successfulVerify.data.reference, async (attempt) => {
      attempts.push(attempt.attempt);
    });

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attempts).toEqual([1, 2]);
  });

  it('does not retry a provider 4xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: false, message: 'not found' }), { status: 400 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new PaystackClient('sk_test_value', 'https://api.paystack.test');

    await expect(client.verify('GDG-20261025-ABCDEFGH', async () => undefined)).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed success body instead of inferring payment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new PaystackClient('sk_test_value', 'https://api.paystack.test');

    await expect(client.verify('GDG-20261025-ABCDEFGH', async () => undefined)).rejects.toBeInstanceOf(ProviderResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries one network error', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(new Response(JSON.stringify(successfulVerify), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new PaystackClient('sk_test_value', 'https://api.paystack.test');

    const result = await client.verify(successfulVerify.data.reference, async () => undefined);

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
