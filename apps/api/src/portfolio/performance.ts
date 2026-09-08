import type { ChangeDto, PerformanceBasis } from '@svinooh/shared';

/**
 * The two ways to answer "what did this portfolio do".
 *
 * The difference between them is money the owner moved. Withdraw $5,000 from
 * $100,000 and the balance falls 5% — `raw` reports that, correctly, because
 * the balance did fall. It just isn't a loss. `net-flows` nets those movements
 * off and reports what the holdings themselves did.
 *
 * Both live here, behind one interface, rather than one being the "real" one
 * and the other a correction applied somewhere downstream. They are two
 * measures of one period and neither is derived from the other's answer.
 */

/** One reading of the portfolio, as the history assembles it */
export interface Sample {
  t: number;
  usd: number;
}

/** Money crossing the portfolio's edge. `usd` is signed: in positive, out negative. */
export interface Flow {
  t: number;
  usd: number;
}

export interface PerformanceStrategy {
  basis: PerformanceBasis;
  /**
   * The line to draw, one value per sample. `null` where this basis has nothing
   * honest to say at that point.
   */
  line(samples: Sample[], flows: Flow[]): Array<number | null>;
  /** What the given window did. `samples` is already cut to the window. */
  measure(samples: Sample[], flows: Flow[]): ChangeDto;
}

/** Nothing to measure — a window with one reading or none has no change in it */
const NOTHING: ChangeDto = { usd: 0, pct: null };

/**
 * What the balance did — the measure this product has always shown.
 *
 * Kept exactly as the client computed it, including `pct: 0` when the window
 * opens at zero: a portfolio that started empty is not "up infinity percent",
 * and this is the behaviour the page has had all along.
 */
export const rawBasis: PerformanceStrategy = {
  basis: 'raw',

  line: (samples) => samples.map((s) => s.usd),

  measure(samples) {
    if (samples.length < 2) return NOTHING;
    const first = samples[0].usd;
    const last = samples[samples.length - 1].usd;
    const usd = last - first;
    return { usd, pct: first ? (usd / first) * 100 : 0 };
  },
};

/**
 * What the holdings did, with deposits and withdrawals netted off.
 *
 * The line is the balance less the flows that have happened so far:
 *
 *     adjusted(t) = V(t) − Σ { f.usd : f.t ≤ t }
 *
 * The anchor is arbitrary and that is the point — the sum is taken over
 * whatever flows the caller passed in, and the DIFFERENCE between two points is
 * `V₁ − V₀ − (flows between them)` no matter where the running total started.
 * So the line can be built over the whole fetched span while a window's change
 * is measured over just that window, and the two agree.
 *
 * The percentage is Modified Dietz:
 *
 *     pct = (V₁ − V₀ − ΣF) / (V₀ + Σ wᵢFᵢ),   wᵢ = (T − tᵢ) / T
 *
 * — the result over the capital that was actually at work, each deposit
 * weighted by how much of the period it was present for. Money that arrived
 * with an hour left in the window barely counts towards the base it is measured
 * against, which is what stops a late deposit from diluting a good month.
 *
 * Not TWR, which is the textbook answer to this question: TWR needs the
 * portfolio's exact value immediately before and immediately after every flow,
 * and this system reads balances every five to thirty minutes through sources
 * that occasionally return a bad number — smoothSeries exists because of it.
 * Modified Dietz needs the two endpoints and the flows, all of which are solid.
 */
export const netFlowsBasis: PerformanceStrategy = {
  basis: 'net-flows',

  line(samples, flows) {
    if (!flows.length) return samples.map((s) => s.usd);
    const ordered = [...flows].sort((a, b) => a.t - b.t);
    const out: Array<number | null> = [];
    let i = 0;
    let cumulative = 0;
    for (const sample of samples) {
      while (i < ordered.length && ordered[i].t <= sample.t) cumulative += ordered[i++].usd;
      out.push(sample.usd - cumulative);
    }
    return out;
  },

  measure(samples, flows) {
    if (samples.length < 2) return NOTHING;
    const from = samples[0].t;
    const to = samples[samples.length - 1].t;
    const span = to - from;
    const first = samples[0].usd;
    const last = samples[samples.length - 1].usd;

    // Only what happened INSIDE the window. A flow on the boundary is counted
    // once, at the opening edge, where the balance that follows it already
    // includes it.
    const inside = flows.filter((f) => f.t > from && f.t <= to);
    const net = inside.reduce((sum, f) => sum + f.usd, 0);
    const usd = last - first - net;

    // The capital the result is measured against: what was there at the start,
    // plus each flow for the fraction of the window it was present. A window
    // with no width has no weighting to do and falls back to the opening value.
    const weighted =
      span > 0
        ? inside.reduce((sum, f) => sum + f.usd * ((to - f.t) / span), 0)
        : 0;
    const base = first + weighted;

    // A base of zero or less is a portfolio that had nothing to earn on — one
    // opened empty and emptied again. There is a dollar answer and no honest
    // rate, and quoting one would be dividing by however close to nothing the
    // base happened to land.
    return { usd, pct: base > 0 ? (usd / base) * 100 : null };
  },
};

export const BASES: Record<PerformanceBasis, PerformanceStrategy> = {
  raw: rawBasis,
  'net-flows': netFlowsBasis,
};

/**
 * The stretch of a series the period's buttons are asking about.
 *
 * The series reaches back several windows so the chart has somewhere to scroll
 * to; this is the part the headline figure is about. It starts at the first
 * reading inside the window and ends at the newest one — scrolling the chart
 * does not move it, because "+0.42% · 24H" means the last 24 hours wherever the
 * reader has wandered off to.
 *
 * `windowMs` of null is the `all` period: the whole series is the window.
 */
export function windowOf<T extends { t: number }>(samples: T[], windowMs: number | null): T[] {
  if (samples.length < 2 || windowMs === null) return samples;
  const opens = samples[samples.length - 1].t - windowMs;
  const at = samples.findIndex((s) => s.t >= opens);
  return at <= 0 || at > samples.length - 2 ? samples : samples.slice(at);
}
