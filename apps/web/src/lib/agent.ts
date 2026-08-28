import type { HistoryRange } from '@svinooh/shared';
import type { Series } from './history';

/**
 * Whether the agent tab is reachable at all.
 *
 * The tab is built and it works; it is simply not switched on yet, because it
 * answers off the portfolio in the browser rather than off a service. Flipping
 * this to `true` is the whole release — both navigations read it, so neither
 * can end up offering a page the other hides.
 *
 * Deliberately not an env var: it is a decision about what is finished, and it
 * changes in a commit somebody can point at.
 */
export const AGENT_ENABLED = false;

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
 * One neutral line, and it claims nothing about what is happening. Anything
 * more specific — "Recalculating health factors" — is the agent describing its
 * own work, and only the thing doing the work can honestly say that. Guessing
 * it from the question in the browser means the status is a lie whenever the
 * guess is wrong, and it is a second place that has to know what questions
 * exist.
 *
 * The seam for the real one is `AgentStatus` on the answerer: when the service
 * can report what it is doing, it reports it here and this constant stops being
 * the only thing shown.
 */
export const THINKING = 'Working on it';

/**
 * How an answerer says what it is doing, if it can.
 *
 * Optional on purpose: an answerer that cannot report progress simply never
 * calls it, and the chat shows `THINKING` for as long as it waits. Nothing in
 * the chat has to know which kind it is talking to.
 */
export type AgentStatus = (text: string) => void;

/** What answers a question. Local today, a request to the agent service later. */
export type Answerer = (question: string, onStatus?: AgentStatus) => Promise<AgentBlock[]>;
