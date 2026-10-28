import type { Logger } from 'pino';
import { formatNaira } from '../domain/money.js';

type ChordThread = {
  id: string;
  teammate_id: string;
  channel_id: string;
  control_state: 'agent_active' | 'human_active' | 'paused';
  last_turn_at: number;
  last_turn_preview?: string;
};

type ChordTurn = {
  direction: 'inbound' | 'outbound';
  sender?: { kind?: string };
  content?: { text?: string };
  delivery_status?: string | null;
};

export type PaidOrderNotification = {
  reference: string;
  item: string;
  amountNgn: number;
};

export interface PaidOrderNotifier {
  notifyPaid(order: PaidOrderNotification): Promise<'sent' | 'already_sent'>;
}

export class ChordApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ChordApiError';
  }
}

function textOf(turn: ChordTurn): string {
  return turn.content?.text ?? '';
}

function isCheckoutTurn(turn: ChordTurn, reference: string): boolean {
  const text = textOf(turn);
  return turn.direction === 'outbound'
    && turn.sender?.kind === 'agent'
    && text.includes(reference)
    && text.includes('checkout.paystack.com');
}

function isDeliveredPaidReceipt(turn: ChordTurn, reference: string): boolean {
  const text = textOf(turn);
  const delivered = ['sent', 'delivered', 'read'].includes(turn.delivery_status ?? '');
  return turn.direction === 'outbound'
    && delivered
    && text.includes(reference)
    && /(Payment confirmed automatically|Payment status:\s*Paid|Payment confirmed|payment is verified)/i.test(text);
}

export class ChordClient implements PaidOrderNotifier {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly workspaceId: string,
    private readonly teammateId: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async notifyPaid(order: PaidOrderNotification): Promise<'sent' | 'already_sent'> {
    const threads = await this.listRecentThreads();
    const likely = threads.filter((thread) =>
      thread.teammate_id === this.teammateId
      && thread.channel_id === 'external_chat'
      && (thread.last_turn_preview?.includes(order.reference) ?? false)
    );
    const fallback = threads
      .filter((thread) => thread.teammate_id === this.teammateId && thread.channel_id === 'external_chat')
      .sort((a, b) => b.last_turn_at - a.last_turn_at)
      .slice(0, 10);
    const candidates = likely.length > 0 ? likely : fallback;

    const matches: Array<{ thread: ChordThread; turns: ChordTurn[] }> = [];
    for (const thread of candidates) {
      const turns = await this.listTurns(thread.id);
      if (turns.some((turn) => isCheckoutTurn(turn, order.reference))) {
        matches.push({ thread, turns });
      }
    }

    if (matches.length !== 1) {
      throw new ChordApiError(`Expected one Chord thread for ${order.reference}; found ${matches.length}`);
    }

    const match = matches[0]!;
    const alreadySent = match.turns.some((turn) => isDeliveredPaidReceipt(turn, order.reference));
    if (alreadySent) {
      if (match.thread.control_state === 'human_active') await this.handBack(match.thread.id);
      return 'already_sent';
    }
    if (match.thread.control_state !== 'agent_active') {
      throw new ChordApiError(`Chord thread ${match.thread.id} is ${match.thread.control_state}; refusing to interrupt it`);
    }

    let tookOver = false;
    let sendError: unknown;
    try {
      await this.request(`/v1/threads/${match.thread.id}/take-over`, {
        method: 'POST',
        body: JSON.stringify({ reason: `Automatic Paystack confirmation for ${order.reference}` })
      });
      tookOver = true;
      const sent = await this.request<ChordTurn>(`/v1/threads/${match.thread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: this.receipt(order) })
      });
      if (!['sent', 'delivered', 'read'].includes(sent.delivery_status ?? '')) {
        throw new ChordApiError(`Chord recorded the receipt but channel delivery was ${sent.delivery_status ?? 'unknown'}`);
      }
    } catch (error) {
      sendError = error;
    } finally {
      if (tookOver) {
        try {
          await this.handBack(match.thread.id);
        } catch (error) {
          this.logger.error({ error, threadId: match.thread.id, reference: order.reference }, 'Chord thread hand-back failed');
          if (!sendError) sendError = error;
        }
      }
    }
    if (sendError) throw sendError;
    return 'sent';
  }

  private receipt(order: PaidOrderNotification): string {
    return [
      'Payment confirmed automatically.',
      '',
      'Payment receipt',
      `Item: ${order.item}`,
      `Amount: ${formatNaira(order.amountNgn * 100)}`,
      `Reference: ${order.reference}`,
      'Payment status: Paid',
      '',
      'Thank you for shopping with Jojo Gadgets. The default warranty is 3 months, subject to confirmation for this unit.',
      '',
      'Would you prefer shop pickup, or should Uchenna review a delivery request?'
    ].join('\n');
  }

  private async listRecentThreads(): Promise<ChordThread[]> {
    const query = new URLSearchParams({
      workspace_id: this.workspaceId,
      agent_id: this.teammateId,
      status: 'open',
      limit: '50'
    });
    const response = await this.request<{ threads: ChordThread[] }>(`/v1/threads?${query}`);
    return response.threads;
  }

  private async listTurns(threadId: string): Promise<ChordTurn[]> {
    const response = await this.request<{ turns: ChordTurn[] }>(`/v1/threads/${threadId}/turns?limit=50`);
    return response.turns;
  }

  private async handBack(threadId: string): Promise<void> {
    await this.request(`/v1/threads/${threadId}/hand-back`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Automatic payment receipt delivered; returning control to the teammate' })
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'x-request-id': crypto.randomUUID(),
        ...init.headers
      },
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.text();
    if (!response.ok) {
      throw new ChordApiError(`Chord API ${response.status}: ${body.slice(0, 500)}`, response.status);
    }
    return (body ? JSON.parse(body) : {}) as T;
  }
}
