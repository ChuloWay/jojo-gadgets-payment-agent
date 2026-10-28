import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ChordClient } from '../src/chord/client.js';

const logger = pino({ level: 'silent' });
const reference = 'GDG-20261028-ABCDEFGH';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function thread(id: string, preview: string) {
  return {
    id,
    teammate_id: 'tm-jojo',
    channel_id: 'external_chat',
    control_state: 'agent_active',
    last_turn_at: 100,
    last_turn_preview: preview
  };
}

function checkoutTurn(ref = reference) {
  return {
    direction: 'outbound',
    sender: { kind: 'agent' },
    content: { text: `Reference: ${ref}\nPay here: https://checkout.paystack.com/test` },
    delivery_status: 'sent'
  };
}

describe('ChordClient proactive payment notifications', () => {
  it('routes by the exact checkout reference, sends once, and returns control to the teammate', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      if (url.includes('/v1/threads?')) return jsonResponse({ threads: [thread('thread-right', reference), thread('thread-other', 'another order')] });
      if (url.includes('/thread-right/turns')) return jsonResponse({ turns: [checkoutTurn()] });
      if (url.includes('/thread-other/turns')) return jsonResponse({ turns: [checkoutTurn('GDG-20261028-ZZZZZZZZ')] });
      if (url.endsWith('/take-over')) return jsonResponse({ control_state: 'human_active' });
      if (url.endsWith('/messages')) return jsonResponse({ direction: 'outbound', delivery_status: 'sent' }, 201);
      if (url.endsWith('/hand-back')) return jsonResponse({ control_state: 'agent_active' });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const client = new ChordClient('https://api.chord.test', 'secret', 'ws-1', 'tm-jojo', logger, fetchMock as typeof fetch);

    await expect(client.notifyPaid({ reference, item: 'Samsung Galaxy S23 (New, 256GB)', amountNgn: 850_000 })).resolves.toBe('sent');

    expect(requests.filter((request) => request.url.endsWith('/take-over'))).toHaveLength(1);
    expect(requests.filter((request) => request.url.endsWith('/messages'))).toHaveLength(1);
    expect(requests.filter((request) => request.url.endsWith('/hand-back'))).toHaveLength(1);
    const message = requests.find((request) => request.url.endsWith('/messages'))!;
    expect(JSON.parse(message.body!)).toMatchObject({
      text: expect.stringContaining(`Reference: ${reference}`)
    });
    expect(JSON.parse(message.body!).text).toContain('Amount: ₦850,000');
  });

  it('refuses to send when the exact reference appears in more than one checkout thread', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/v1/threads?')) return jsonResponse({ threads: [thread('thread-one', reference), thread('thread-two', reference)] });
      if (url.includes('/turns')) return jsonResponse({ turns: [checkoutTurn()] });
      throw new Error(`Unexpected mutation: ${url}`);
    });
    const client = new ChordClient('https://api.chord.test', 'secret', 'ws-1', 'tm-jojo', logger, fetchMock as typeof fetch);

    await expect(client.notifyPaid({ reference, item: 'Phone', amountNgn: 1 })).rejects.toThrow('found 2');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(false);
  });

  it('deduplicates a receipt that the channel already delivered', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/v1/threads?')) return jsonResponse({ threads: [thread('thread-one', reference)] });
      if (url.includes('/turns')) {
        return jsonResponse({ turns: [checkoutTurn(), {
          direction: 'outbound',
          sender: { kind: 'human_operator' },
          content: { text: `Payment confirmed automatically.\nReference: ${reference}` },
          delivery_status: 'sent'
        }] });
      }
      throw new Error(`Unexpected mutation: ${url}`);
    });
    const client = new ChordClient('https://api.chord.test', 'secret', 'ws-1', 'tm-jojo', logger, fetchMock as typeof fetch);

    await expect(client.notifyPaid({ reference, item: 'Phone', amountNgn: 1 })).resolves.toBe('already_sent');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(false);
  });
});
