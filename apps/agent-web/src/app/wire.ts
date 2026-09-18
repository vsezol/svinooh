import { identityHeaders } from './identity';
import { WIRE_SCHEMA } from './types';
import type { AgentBlock, ChatWire } from './types';

/**
 * Status semantics: the HTTP status for server answers, 0 when the request
 * never reached the service, -1 when a stream opened and then failed partway,
 * -2 when the response arrived but this build cannot read it (unparseable body
 * or an unknown wire schema).
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

/**
 * What every call to the service carries: who is asking, in both the ways it
 * can be answered. The token names an account; the anonymous id names a
 * browser that has not made one, which is what a conversation is filed under
 * until it does. See app/identity.ts.
 */
export function agentHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { ...identityHeaders() };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function sendChat(input: SendChatInput): Promise<SendChatResult> {
  const headers = { ...agentHeaders(input.token), 'content-type': 'application/json' };

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

/**
 * The same turn, read as it is written.
 *
 * `onToken` is called with each piece as it lands and `onStep` with each
 * operation as it starts and finishes; the promise resolves with the finished
 * answer, which is what the caller should render. The two are not
 * quite the same thing on purpose — the service says so too. Tokens are what
 * the model is typing, and a branch that answers from a fixed sentence types
 * nothing at all, so the last event carries the answer and the pieces before
 * it are a preview.
 *
 * Falls back to the whole-answer endpoint on a 404, which is what an older
 * service looks like for the minute a deploy takes. Nobody should watch a
 * chat break because two services rolled over in the wrong order.
 */
/** One operation the service reported, as it started or as it finished. */
export interface StepEvent {
  id: string;
  label?: string;
  state: 'running' | 'done' | 'failed';
  detail?: string;
  /** How long it took, from the service, once it is over. */
  ms?: number;
  /**
   * When this side first heard the step start.
   *
   * Added here rather than sent, because it is what a running step counts up
   * from and the service cannot say it — the number that matters to somebody
   * watching is how long they have been waiting, which is measured from when
   * the line appeared in front of them.
   */
  startedAt?: number;
}

export interface StreamHandlers {
  /** A piece of the answer as it is written. */
  onToken: (text: string) => void;
  /** An operation starting or finishing. Every one of these actually ran. */
  onStep?: (step: StepEvent) => void;
}

export async function streamChat(
  input: SendChatInput,
  handlers: StreamHandlers,
): Promise<SendChatResult> {
  const headers = { ...agentHeaders(input.token), 'content-type': 'application/json' };

  let res: Response;
  try {
    res = await fetch(`${input.agentUrl}/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: input.message,
        session_id: input.sessionId,
        portfolio: input.portfolio,
      }),
    });
  } catch {
    throw new WireError(0, 'the agent service is unreachable');
  }

  if (res.status === 404) return sendChat(input);
  if (!res.ok || !res.body) {
    const retryAfterS = res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : undefined;
    throw new WireError(res.status, `agent answered ${res.status}`, retryAfterS);
  }

  let finished: SendChatResult | null = null;
  let failed: string | null = null;

  for await (const [event, data] of readEvents(res.body)) {
    if (event === 'token' && typeof data.text === 'string') {
      handlers.onToken(data.text);
    } else if (event === 'step' && typeof data.id === 'string') {
      handlers.onStep?.(data as unknown as StepEvent);
    } else if (event === 'error') {
      failed = typeof data.message === 'string' ? data.message : 'the answer stopped partway';
    } else if (event === 'done') {
      const wire = data as unknown as ChatWire;
      if (wire.schema !== WIRE_SCHEMA) throw new WireError(-2, `unknown wire schema ${String(wire.schema)}`);
      finished = { blocks: wire.blocks, sessionId: wire.session_id };
    }
  }

  if (finished) return finished;
  // A stream that ends without either is a connection dropped mid-answer,
  // which reads to the person exactly like one that said so.
  throw new WireError(-1, failed ?? 'the answer stopped partway');
}

/**
 * Server-sent events out of a byte stream.
 *
 * Small enough to write, and the alternative is not EventSource: that one is
 * GET-only, so it cannot carry a question in a body or a token in a header.
 * A chunk boundary falls wherever the network puts it, so blocks are cut on
 * the blank line that separates events and whatever trails it stays buffered.
 */
async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<[string, Record<string, unknown>]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      let split = buffered.indexOf('\n\n');
      while (split !== -1) {
        const block = buffered.slice(0, split);
        buffered = buffered.slice(split + 2);
        const parsed = parseEvent(block);
        if (parsed) yield parsed;
        split = buffered.indexOf('\n\n');
      }
    }
  } finally {
    // Leaving a reader open holds the connection after the caller has stopped
    // caring — on an error, or when the conversation was switched away from.
    reader.cancel().catch(() => undefined);
  }
}

function parseEvent(block: string): [string, Record<string, unknown>] | null {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    // Multiple data lines concatenate, per the format; ours sends one.
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event) return null;
  try {
    return [event, data ? (JSON.parse(data) as Record<string, unknown>) : {}];
  } catch {
    // One unreadable event is not a reason to drop an answer in progress.
    return null;
  }
}
