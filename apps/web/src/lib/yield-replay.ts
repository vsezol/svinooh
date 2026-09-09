/**
 * A day of USDC lending, replayed in twelve seconds.
 *
 * The card this drives is the landing's answer to "it reads the whole chain,
 * not just your wallets": a clock walks from 00:00 to 24:00, four lenders'
 * bars fill in proportion to how much of the market they hold, and a fee
 * counter ticks up beside each one. It is the shape of the insight, drawn.
 *
 * The figures are an illustration and not a feed. There is no aggregate yields
 * source behind this app yet — positions carry the APY their own protocol
 * reports, and nothing sums the market — so the four rates below are typical
 * of USDC lending rather than measured, and the size of the market they are
 * charged against is a round number. That is also why the card carries no
 * LIVE badge and never says it is polling: a page that claims to be live has
 * to be, and this one is honest about being a replay of a representative day.
 * When there IS a real yields source, this module is the seam it plugs into —
 * the card reads `replayFrame` and nothing else.
 *
 * Wall-clock driven, like everything else on this page: a function of elapsed
 * milliseconds, with no timer and no state of its own.
 */

export interface Lender {
  name: string;
  /** Supply APY as a percentage: 6.8 is 6.8%. */
  apy: number;
  /** How much of the USDC lent across these four sits here. */
  sharePct: number;
  /** What is supplied, in dollars — what the fees below are charged against. */
  suppliedUsd: number;
}

export const LENDERS: readonly Lender[] = [
  { name: 'Morpho', apy: 8.1, sharePct: 34, suppliedUsd: 4_120_000 },
  { name: 'Aave V3', apy: 6.8, sharePct: 31, suppliedUsd: 3_760_000 },
  { name: 'Kamino', apy: 6.2, sharePct: 21, suppliedUsd: 2_540_000 },
  { name: 'Compound V3', apy: 5.4, sharePct: 14, suppliedUsd: 1_690_000 },
];

/** One turn of the clock, and how long it rests on midnight before restarting. */
const LOOP_MS = 12_000;
const HOLD_MS = 2_200;

const MINUTES_A_DAY = 1440;

const money = (usd: number): string =>
  `+$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ReplayRow {
  name: string;
  /** "8.1% APY" */
  apy: string;
  /** "34% of USDC" */
  share: string;
  /** "+$914.63" — what this lender has paid out by the point on the clock. */
  earned: string;
  /** How full this lender's bar is, 0–1, against the largest of the four. */
  fill: number;
}

export interface ReplayFrame {
  /** "17:44" */
  clock: string;
  /** What the four have paid out between them, so far. */
  total: string;
  /** How far the day has run, 0–1 — the progress bar and the clock share it. */
  progress: number;
  /**
   * How bright the head of a bar glows, 0–1. It fades out before the day ends,
   * so the card arrives at midnight already still rather than stopping dead.
   */
  glow: number;
  rows: ReplayRow[];
}

/** The largest share of the four — what every bar is drawn against. */
const LEAD_SHARE = Math.max(...LENDERS.map((l) => l.sharePct));

/** The whole card for one instant. `t` is milliseconds since the page started. */
export function replayFrame(t: number): ReplayFrame {
  const raw = (t % LOOP_MS) / (LOOP_MS - HOLD_MS);
  const p = Math.min(1, raw);
  // Out, not in: the day starts fast and settles onto midnight, which is what
  // makes the hold at the end read as arrival rather than as a stall.
  const progress = 1 - (1 - p) ** 3;

  let total = 0;
  const rows = LENDERS.map((lender) => {
    const day = (lender.suppliedUsd * lender.apy) / 100 / 365;
    const earned = day * progress;
    total += earned;
    return {
      name: lender.name,
      apy: `${lender.apy.toFixed(1)}% APY`,
      share: `${lender.sharePct}% of USDC`,
      earned: money(earned),
      fill: (lender.sharePct / LEAD_SHARE) * progress,
    };
  });

  const mins = Math.floor(progress * MINUTES_A_DAY);
  const clock = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  return {
    clock,
    total: money(total),
    progress,
    // ^6 rather than a linear fade: the glow stays bright through most of the
    // run and then goes quickly, which is the last thing to happen before the
    // card comes to rest.
    glow: p < 1 ? 0.9 * (1 - p ** 6) : 0,
    rows,
  };
}

/**
 * Where the replay sits still — a finished day, for a reader who has asked
 * their system for less movement.
 */
export const REPLAY_AT_REST = LOOP_MS - HOLD_MS;
