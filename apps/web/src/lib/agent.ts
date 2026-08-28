import type { HistoryRange } from '@svinooh/shared';
import type { Series } from './history';

/**
 * What the agent is allowed to say back.
 *
 * An answer is a list of blocks, not a string. The questions people ask about a
 * portfolio have numbers in them — how much, in what, how close to liquidation
 * — and a paragraph that spells those out is a paragraph nobody reads twice. So
 * prose carries the judgement and a widget carries the figures, and this union
 * is the whole vocabulary either side has to agree on.
 *
 * It is deliberately small and closed. Every block here renders from plain data
 * with no styling in it, so the same shapes can come off a wire later without
 * anything in the chat needing to know that they did.
 */
export type AgentBlock =
  | TextBlock
  | StatsBlock
  | ChartBlock
  | TableBlock
  | BarsBlock
  | NoteBlock;

/** The agent talking. One paragraph — several become several blocks. */
export interface TextBlock {
  kind: 'text';
  text: string;
}

/** A row of readings, the shape the portfolio's own metric cards use */
export interface StatsBlock {
  kind: 'stats';
  cards: StatCard[];
}

export interface StatCard {
  label: string;
  value: string;
  /** The line under the figure — what it is a share of, what it did, where it came from */
  note?: string;
  /** `up`/`down` colour it; plain is the default and means "this is context, not news" */
  tone?: 'up' | 'down' | 'muted';
}

/**
 * A line over time, drawn by the same chart as the rest of the app — the
 * gestures, the measuring drag and the window model come with it, so a chart in
 * an answer behaves like a chart anywhere else rather than looking like one.
 */
export interface ChartBlock {
  kind: 'chart';
  title: string;
  series: Series;
  period: HistoryRange;
  /** Bottom-right of the header: the change across the window, already formatted */
  sub?: string;
  subTone?: 'up' | 'down';
  /** `muted` is the grey a debt is drawn in */
  tone?: 'accent' | 'muted';
}

/**
 * Rows against columns. The first column is the name of the thing and the rest
 * are readings, which is why it is the only one left-aligned and the only one
 * not set in the mono face — everything numeric lines up down the right.
 */
export interface TableBlock {
  kind: 'table';
  columns: string[];
  rows: TableCell[][];
}

export interface TableCell {
  text: string;
  /** Left unset, a cell reading "+1.2%" or "−3%" colours itself */
  tone?: 'up' | 'down' | 'muted';
}

/** One measurement each, against a bar that says how much of something it is */
export interface BarsBlock {
  kind: 'bars';
  items: BarItem[];
}

export interface BarItem {
  label: string;
  value: string;
  /** 0–100 */
  percent: number;
  sub?: string;
  tone?: 'up' | 'down' | 'accent';
}

/** The one sentence worth acting on, set apart from the ones that explain it */
export interface NoteBlock {
  kind: 'note';
  text: string;
}

/** A turn in the conversation */
export interface ChatMessage {
  id: string;
  role: 'you' | 'agent';
  /** Set on a question; an answer carries blocks instead */
  text?: string;
  blocks?: AgentBlock[];
}

/**
 * The openers, above the composer.
 *
 * They are the questions the portfolio can actually answer, written the way
 * somebody would ask them — an empty box with a blinking cursor is a question
 * about what this thing is for, and these answer it before it is asked.
 */
export const CHIPS = [
  'Portfolio overview',
  'Top LP by yield',
  'Health factor check',
  'Stablecoin exposure',
  'What changed today',
  'Debt & borrow rates',
] as const;

/**
 * What to say while the answer is being worked out.
 *
 * Not "Thinking…". A portfolio agent that says nothing for two seconds has left
 * the reader wondering whether it understood the question; one that says
 * "Recalculating health factors" has already confirmed it did. Two phrases, so
 * the wait reads as progress rather than as one frozen label — the second lands
 * a beat later.
 *
 * Matched on the question rather than sent by the answerer on purpose: the
 * status has to appear on the keystroke that sends, which is long before
 * anything has been asked of a server.
 */
const STATUS: Array<{ about: RegExp; phrases: [string, string] }> = [
  { about: /pool|lp|liquid|range/i, phrases: ['Scanning your liquidity positions', 'Comparing fee yields across pools'] },
  { about: /health|hf|liquidat|risk/i, phrases: ['Pulling your lending positions', 'Recalculating health factors'] },
  { about: /stable|usdc|usdt|exposure/i, phrases: ['Splitting assets by type', 'Measuring stablecoin exposure'] },
  { about: /debt|borrow|loan|apy/i, phrases: ['Reading your open loans', 'Checking borrow rates'] },
  { about: /chang|today|move|24h/i, phrases: ['Diffing the last 24 hours', 'Ranking the biggest movers'] },
];

const STATUS_FALLBACK: [string, string] = [
  'Reading your portfolio structure',
  'Checking positions across wallets',
];

export function statusFor(question: string): [string, string] {
  return STATUS.find((s) => s.about.test(question))?.phrases ?? STATUS_FALLBACK;
}

/** How long the first status holds before the second one takes over */
export const STATUS_SWITCH_MS = 1100;
