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
  steps: {
    label: string;
    state: 'waiting' | 'running' | 'done' | 'failed';
    detail?: string;
    time?: string;
  }[];
  /** Once folded: "3 steps · 1.9s" */
  summary: string;
  failed?: boolean;
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

export type DepositAction =
  | 'deposit'
  | 'withdraw'
  | 'move'
  | 'swap'
  | 'provide'
  | 'close'
  | 'rebalance';

/** A coin by its mint, and what to call it. */
export interface Coin {
  mint: string;
  symbol: string;
}

/**
 * A card asking the wallet to sign. `pool` is the pool the card is about —
 * where the money goes in a deposit and a move, where it comes out of in a
 * withdrawal; a move also names where it leaves. `payWith` is the coin a
 * deposit spends when that is not the pool's own token, and `receiveAs` the
 * coin a withdrawal ends as — each swapped on the way. A swap has no pool: it
 * trades `payWith` for `receiveAs` inside the wallet. `amount` is tokens of
 * what is spent, or "all", in which case `shown` is what all of it was worth
 * when it was read.
 */
export interface DepositBlock {
  kind: 'deposit';
  action?: DepositAction;
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: 'vault' | 'reserve' | 'dlmm' | 'swap';
  network: string;
  token: string;
  amount: string;
  shown?: string | null;
  apy: string;
  risk: string;
  url: string;
  fromPoolId?: string | null;
  fromPool?: string | null;
  fromApy?: string | null;
  fromToken?: string | null;
  payWith?: Coin | null;
  receiveAs?: Coin | null;
  /**
   * Liquidity for a pair: the range as percent below and above the price, the
   * two prices it reaches and the price now, in the pool's y per x; and the
   * position a close or a rebalance acts on.
   */
  belowPct?: string | null;
  abovePct?: string | null;
  lowerPrice?: string | null;
  upperPrice?: string | null;
  price?: string | null;
  position?: string | null;
  /** The strategy that put this card up, which the agent is told back once it lands */
  strategy?: string | null;
}

export interface DepositRequest {
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: 'vault' | 'reserve' | 'dlmm' | 'swap';
  network: string;
  token: string;
  amount: string;
  action?: DepositAction;
  fromPoolId?: string;
  fromPool?: string;
  fromToken?: string;
  payWith?: Coin;
  receiveAs?: Coin;
  belowPct?: string;
  abovePct?: string;
  position?: string;
  strategy?: string;
}

export type DepositLanding = 'pending' | 'landed' | 'failed';

export type DepositOutcome =
  | {
      ok: true;
      signature?: string;
      landed?: DepositLanding;
      tracked?: boolean;
      error?: string | null;
      halfway?: boolean;
      /** What the money waits in when only part of it went through. */
      holding?: string;
    }
  | { ok: false; reason: string; at?: 'connect' | 'build' | 'wallet' | 'cancelled' };

/**
 * What became of a deposit, as the agent is told it. `token` is what
 * `amount` is counted in — what left — and `into` what it became, when it
 * was swapped on the way.
 */
export interface Settled {
  amount: string;
  token: string;
  pool: string;
  status: 'landed' | 'failed' | 'sent' | 'refused';
  signature?: string | null;
  error?: string | null;
  action?: DepositAction;
  from_pool?: string | null;
  into?: string | null;
  halfway?: boolean;
  holding?: string | null;
  strategy?: string | null;
  position?: string | null;
}

export interface ChoiceBlock {
  kind: 'choice';
  header: string;
  question: string;
  options: string[];
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
  | DepositBlock
  | ChoiceBlock
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

/**
 * One conversation, as this app holds it.
 *
 * `id` is the service's own id for it, which is both the address in the URL
 * and the key its turns are stored under — one identifier, because there is
 * one conversation. `sessionId` is that same id, kept as the field the wire
 * calls read so the request shape did not have to change; a conversation that
 * has never been spoken to has neither yet.
 *
 * `items` is empty on a row that came from the listing — a rail needs a title
 * and a time, and the transcript is fetched when one is opened.
 */
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
  /**
   * A question typed somewhere else, asked the moment the chat is up.
   *
   * The product's front door is a composer on the landing page: what is typed
   * there is the first message of a real conversation, and by the time this
   * mounts it should already be in the log with an answer arriving. Asked
   * exactly once per mount, as if it had been typed here.
   */
  initialQuestion?: string;
  /**
   * The conversations, whenever they change.
   *
   * A host with a rail of its own draws them there — the design puts New chat
   * and the history list in the sidebar, beside the pages, rather than as
   * buttons floating over the transcript. The widget still owns them; this is
   * how it says what it has.
   */
  onConversations?: (list: ConversationRef[]) => void;
  /**
   * Which conversation is on screen, whenever that changes — including the
   * moment a new one is given its id by its first turn.
   *
   * The host puts it in the URL. A conversation is a server object now, so it
   * has an address the way a portfolio does, and that address exists from the
   * first question rather than from a share button that mints one. Null while
   * a fresh chat has not been spoken to yet: there is nothing to link to.
   */
  onConversationId?: (id: string | null) => void;
  onDeposit?: (request: DepositRequest) => Promise<DepositOutcome | void> | void;
  /**
   * A box the component fills in with its two actions, so the handle mount()
   * already returned can reach them. Not part of the public shape — mount
   * makes it and hands the filled version back.
   */
  control?: { newChat: () => void; openConversation: (id: string) => void; openHistory: () => void };
}

/** One conversation, as much of it as a host needs to draw a row. */
export interface ConversationRef {
  id: string;
  title: string;
  /** When it was last spoken to, in ms. */
  at: number;
  /** Whether it is the one on screen. */
  active: boolean;
}

export interface MountHandle {
  unmount(): void;
  /**
   * Revise what the chat was mounted with, without restarting it.
   *
   * A token arrives after the chat is already up — somebody signs in from the
   * sign-in card under their first answer, which is where the product asks —
   * and the alternative was for the host to unmount and mount again. That
   * threw away the conversation on screen at the exact moment it had become
   * worth keeping.
   *
   * Only the options passed are changed; everything else stays as it was.
   */
  update(opts: Partial<MountOptions>): void;
  /** Start a fresh conversation, as the rail's New chat does. */
  newChat(): void;
  /** Open one of the conversations reported through `onConversations`. */
  openConversation(id: string): void;
  /**
   * Show the list of past conversations.
   *
   * For a host with nowhere to draw them itself — a phone, where there is no
   * rail. The chat opens its own sheet, which is the one the design draws.
   */
  openHistory(): void;
}
