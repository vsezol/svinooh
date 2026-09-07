import { WIRE_SCHEMA } from './types';
import type { AgentBlock, ChatWire } from './types';

/**
 * Status semantics: the HTTP status for server answers, 0 when the request
 * never reached the service, -2 when the response arrived but this build
 * cannot read it (unparseable body or an unknown wire schema).
 */
export class WireError extends Error {
  readonly status: number;
  readonly retryAfterS?: number;

  constructor(status: number, message: string, retryAfterS?: number) {
    super(message);
    this.name = 'WireError';
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

export interface SendChatInput {
  agentUrl: string;
  token?: string;
  portfolio?: string;
  sessionId?: string;
  message: string;
}

export interface SendChatResult {
  blocks: AgentBlock[];
  sessionId: string;
}

export async function sendChat(input: SendChatInput): Promise<SendChatResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.token) headers.authorization = `Bearer ${input.token}`;

  let res: Response;
  try {
    res = await fetch(`${input.agentUrl}/chat`, {
      method: 'POST',
      headers,
      // undefined fields drop out of the JSON — the service treats a missing
      // session_id as "start a new session".
      body: JSON.stringify({
        message: input.message,
        session_id: input.sessionId,
        portfolio: input.portfolio,
      }),
    });
  } catch {
    throw new WireError(0, 'the agent service is unreachable');
  }

  if (!res.ok) {
    const retryAfterS = res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : undefined;
    throw new WireError(res.status, `agent answered ${res.status}`, retryAfterS);
  }

  let wire: ChatWire;
  try {
    wire = (await res.json()) as ChatWire;
  } catch {
    throw new WireError(-2, 'unreadable agent response');
  }
  if (wire.schema !== WIRE_SCHEMA) {
    throw new WireError(-2, `unknown wire schema ${String(wire.schema)}`);
  }

  return { blocks: wire.blocks, sessionId: wire.session_id };
}

function parseRetryAfter(value: string | null): number | undefined {
  // Retry-After may also be an HTTP date; the service sends plain seconds,
  // anything else degrades to "no countdown".
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
