/**
 * The shared contracts of the agent frontend. Everything here is agreed API
 * between modules — change it only together with every consumer.
 *
 * Wire types mirror the service's ChatResponse (schema 1). Kinds beyond
 * `text` are not emitted by the service yet; the renderer implements the full
 * vocabulary now (DESIGN-SPEC.md), the wire grows into it additively.
 */
import type { HistoryRange } from '@svinooh/shared';

// ── the wire ────────────────────────────────────────────────────────────────

export const WIRE_SCHEMA = 1;

export interface TextBlock {
  kind: 'text';
  text: string;
}

export interface StatsBlock {
  kind: 'stats';
  items: { label: string; value: string; sub?: string; tone?: 'up' | 'down' | 'mut' }[];
}

export interface ChartBlock {
  kind: 'chart';
  title: string;
  delta?: string;
  deltaTone?: 'up' | 'down';
  /**
   * The readings, in time order. `t` is a real timestamp in milliseconds, not
   * a label: the chart the app draws is the chart the assistant draws, and
   * that one scrolls, measures a span between two points and reads a value
   * under the pointer — none of which is possible against pretty strings.
   */
  points: { t: number; v: number }[];
  /** Which window the readings cover, which is what sets the chart's scale. */
  period: HistoryRange;
}

export interface TableBlock {
  kind: 'table';
  columns: { key: string; label: string; align?: 'left' | 'right'; mobile?: boolean }[];
  rows: Record<string, string>[];
  /** Per-cell tone by column key, resolved from the raw value's leading sign when absent. */
  note?: string;
}

export interface BarsBlock {
  kind: 'bars';
  items: { label: string; value: string; percent: number; sub?: string }[];
}

export interface NoteBlock {
  kind: 'note';
  text: string;
}

/**
 * The work behind an answer, step by step.
 *
 * Live while it runs and folded once it is done — the same block in two
 * states, because it is the same thing: a receipt for the wait.
 */
export interface TraceBlock {
  kind: 'trace';
  steps: { label: string; state: 'waiting' | 'running' | 'done'; time?: string }[];
  /** Once folded: "3 steps · 1.9s" */
  summary: string;
  collapsed: boolean;
}

/** Where an answer leads — the position it described, the alert it suggested. */
export interface LinksBlock {
  kind: 'links';
  links: { label: string; href: string }[];
}

export interface SignInBlock {
  kind: 'signin';
  title: string;
  sub: string;
  /** The question re-asked automatically after the auth flow completes. */
  pendingQuestion?: string;
}

export type ConfirmAddress = {
  address: string;
  chain: 'EVM' | 'SOLANA' | 'TRON' | 'BITCOIN';
  /** created-state only */
  outcome?: 'added' | 'refused';
  reason?: string;
};

export interface ConfirmBlock {
  kind: 'confirm';
  state: 'pending' | 'created' | 'declined';
  title: string;
  addresses: ConfirmAddress[];
  /** created-state: where the new portfolio lives */
  portfolioName?: string;
  portfolioUrl?: string;
  summary?: string;
}

export interface UnknownBlock {
  kind: string;
  [key: string]: unknown;
}

export type AgentBlock =
  | TextBlock
  | StatsBlock
  | ChartBlock
  | TableBlock
  | BarsBlock
  | NoteBlock
  | TraceBlock
  | LinksBlock
  | SignInBlock
  | ConfirmBlock
  | UnknownBlock;

export interface ChatWire {
  schema: number;
  blocks: AgentBlock[];
  reply: string;
  session_id: string;
}

// ── conversation state ──────────────────────────────────────────────────────

export type ChatItem =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'agent'; blocks: AgentBlock[] }
  | { id: string; role: 'note'; text: string; retryAfterS?: number }
  | { id: string; role: 'status'; text: string };

export interface Conversation {
  id: string;
  title: string;
  /** epoch ms of the last turn — the shell formats it relatively */
  at: number;
  sessionId?: string;
  items: ChatItem[];
}

export interface PortfolioRef {
  slug: string;
  name: string;
  totalUsd?: number;
  wallets?: number;
}

// ── the mount contract (the whole surface a host knows) ─────────────────────

export interface MountOptions {
  /** Agent service origin, e.g. https://agent-production-xxxx.up.railway.app */
  agentUrl: string;
  /** Caller's JWT without the Bearer prefix; absent = anonymous. */
  token?: string;
  /** The portfolio on the host's screen — grounds the answers. */
  portfolioSlug?: string;
  /** Every portfolio the user owns, when the host knows — enables the switcher. */
  portfolios?: PortfolioRef[];
  theme?: 'dark' | 'light';
  /** Host-decided pro gate: chat visible, composer replaced by the Pro card. */
  locked?: boolean;
  /** 'embedded' hides the standalone chrome (logo header); default 'embedded'. */
  variant?: 'embedded' | 'standalone';
  /** Signed-in state the shell already knows (avoids a flash in the door). */
  signedIn?: boolean;
}

export interface MountHandle {
  unmount(): void;
}
