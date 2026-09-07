/**
 * Device-local conversation store. The agent service keeps no durable
 * history yet; when it grows one, this module becomes wire calls and the
 * localStorage key retires.
 */
import type { Conversation } from './types';

const KEY = 'svinooh_agent_history_v1';
const MAX_CONVERSATIONS = 50;
const MAX_ITEMS = 80;
const TITLE_MAX = 60;

function read(): Conversation[] {
  // localStorage can throw (private mode, in-app browsers) and the stored
  // value can be foreign garbage — both degrade to an empty history.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

function write(conversations: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(conversations));
  } catch {
    // Quota or blocked storage: the conversation lives on in memory only.
  }
}

function titleOf(conversation: Conversation): string {
  const first = conversation.items.find((item) => item.role === 'user');
  const text = first && 'text' in first ? first.text.trim() : '';
  if (!text) return 'New chat';
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

/** Newest first. */
export function list(): Conversation[] {
  return read().sort((a, b) => b.at - a.at);
}

/**
 * Upserts and returns the normalized record (derived title, items capped to
 * the most recent MAX_ITEMS) so callers can mirror it in memory when
 * storage is unavailable.
 */
export function save(conversation: Conversation): Conversation {
  const normalized: Conversation = {
    ...conversation,
    title: titleOf(conversation),
    items: conversation.items.slice(-MAX_ITEMS),
  };
  const rest = read().filter((c) => c.id !== normalized.id);
  write([normalized, ...rest].slice(0, MAX_CONVERSATIONS));
  return normalized;
}

export function remove(id: string): void {
  write(read().filter((c) => c.id !== id));
}
