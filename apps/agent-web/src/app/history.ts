/**
 * Past conversations, read from the service.
 *
 * This module used to be a device-local store — a localStorage key holding
 * fifty conversations — and said in its own comment that it would become wire
 * calls once the service grew durable history. It has, so this is that: the
 * conversations live in the agent's own store, keyed on who is asking
 * (app/identity.ts), and every browser that person opens sees the same list.
 *
 * `svinooh_agent_history_v1` is retired rather than migrated. What was in it
 * was one browser's copy of conversations whose model context was lost on the
 * next restart anyway — half a record each, and no way to tell whose they
 * were. Uploading them would file somebody else's transcript under whoever is
 * sitting at the machine now, which is exactly what the privacy rule forbids.
 * The key is deleted on first load so it stops taking up quota.
 */
import { agentHeaders } from './wire';
import type { AgentBlock, ChatItem, Conversation } from './types';

/** The device-local store this replaced. Removed on sight, never read. */
const RETIRED_KEY = 'svinooh_agent_history_v1';

interface ChatSummaryWire {
  id: string;
  title: string;
  at: number;
}

interface ChatTurnWire {
  q: string;
  a: string;
  at: number;
  blocks: AgentBlock[];
}

export interface ChatsInput {
  agentUrl: string;
  token?: string;
}

/**
 * Drop the old browser-local history.
 *
 * Called once when the chat starts. Deliberately not a migration: see the
 * note at the top of this file for why those records are not ours to upload.
 */
export function retireLocalHistory(): void {
  try {
    localStorage.removeItem(RETIRED_KEY);
  } catch {
    // Blocked storage has nothing to remove.
  }
}

async function json<T>(url: string, token: string | undefined, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, headers: agentHeaders(token) });
    if (!res.ok) return null;
    return res.status === 204 ? ({} as T) : ((await res.json()) as T);
  } catch {
    // The list is not the conversation. A service that cannot be reached
    // leaves the rail empty rather than stopping somebody from asking.
    return null;
  }
}

/** Newest first, or empty when the service cannot say. */
export async function list(input: ChatsInput): Promise<Conversation[]> {
  const wire = await json<{ chats: ChatSummaryWire[] }>(`${input.agentUrl}/chats`, input.token);
  if (!wire?.chats) return [];
  // Rows, not conversations: the transcript arrives when one is opened. A
  // rail draws a title and a time, and fetching fifty transcripts to show
  // fifty titles is the kind of thing that makes a sidebar slow.
  return wire.chats.map((chat) => ({ id: chat.id, title: chat.title, at: chat.at, items: [] }));
}

/**
 * One conversation, whole.
 *
 * Null when it is not this caller's — the service answers 404 for somebody
 * else's id, because confirming it exists is itself the thing being kept
 * private. The chat treats that as "no such conversation" and starts a fresh
 * one, which is the honest outcome of following a link that is not yours.
 */
export async function read(input: ChatsInput, id: string): Promise<Conversation | null> {
  const wire = await json<{ id: string; title: string; at: number; turns: ChatTurnWire[] }>(
    `${input.agentUrl}/chats/${encodeURIComponent(id)}`,
    input.token,
  );
  if (!wire?.id) return null;
  return {
    id: wire.id,
    title: wire.title,
    at: wire.at,
    sessionId: wire.id,
    items: wire.turns.flatMap(itemsOf),
  };
}

export async function remove(input: ChatsInput, id: string): Promise<void> {
  await json(`${input.agentUrl}/chats/${encodeURIComponent(id)}`, input.token, {
    method: 'DELETE',
  });
}

/**
 * One stored turn as the two things on screen it was.
 *
 * The blocks are the service's own — what the reader saw — rather than the
 * answer text re-wrapped here. A turn that drew a chart reopens as that chart
 * for the same reason the chart was the chart in the first place.
 */
function itemsOf(turn: ChatTurnWire, index: number): ChatItem[] {
  const blocks = turn.blocks?.length ? turn.blocks : [{ kind: 'text', text: turn.a } as AgentBlock];
  return [
    { id: `${index}-q`, role: 'user', text: turn.q },
    { id: `${index}-a`, role: 'agent', blocks },
  ];
}
