import type { DefiFacts, ScanPosition } from '@svinooh/shared';

/** Nothing was asked, or nothing answered — either way there is nothing to fill in */
export const NO_FACTS: DefiFacts = { pools: [], lending: [], failed: [] };

/** How a pair is written so two spellings of the same pool still meet */
export function pairKey(a: string | null | undefined, b: string | null | undefined): string {
  return [a ?? '', b ?? '']
    .map((s) => s.trim().toUpperCase())
    .sort()
    .join('|');
}

/** A loan the aggregator described without saying how healthy it is or what it costs */
export function needsLendingFacts(positions: ScanPosition[]): boolean {
  return positions.some(
    (p) =>
      (p.tokens ?? []).some((t) => t.role === 'borrow') &&
      (p.healthRate == null || p.borrowApy == null),
  );
}

/** The pair a position is made of, or null when it isn't a pair at all */
function pairOf(position: ScanPosition): string | null {
  const supplied = (position.tokens ?? []).filter((t) => t.role === 'supply');
  return supplied.length === 2 ? pairKey(supplied[0].symbol, supplied[1].symbol) : null;
}

/** The one fact that can only be about this position, or nothing */
function only<T>(candidates: T[]): T | null {
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Fills in what the aggregator left blank, and nothing else.
 *
 * Jupiter and DeBank decide what a wallet holds and what it is worth; this
 * never adds a position, removes one, or touches a value. What it changes is
 * three fields the aggregators do not report:
 *
 *  - `range`, which svinooh otherwise infers from which side of a pair the
 *    position is holding. The protocol compares the pool's current tick with
 *    the position's own bounds, which is the actual question, so its answer
 *    replaces the inference.
 *  - `healthRate` and `borrowApy`, which are simply absent for most sources.
 *    An aggregator that did report them is left alone.
 *
 * A position is matched to a fact by its pair, or by the asset it borrowed —
 * neither is an identity. So a match is only used when exactly one fact can be
 * about this position: a wallet with two positions in the same pool gets the
 * inference it had before rather than a coin-flip between two bands, because a
 * confidently wrong range on somebody's money is worse than an approximate one.
 */
export function enrich(positions: ScanPosition[], facts: DefiFacts): ScanPosition[] {
  if (!facts.pools.length && !facts.lending.length) return positions;

  return positions.map((position) => {
    const patch: Partial<ScanPosition> = {};

    const pair = pairOf(position);
    if (pair) {
      const pool = only(facts.pools.filter((p) => p.pair === pair));
      // A full-range position has no band to be outside of, and saying "in
      // range" of a pool that spans every price is a badge that means nothing
      if (pool && !pool.isFullRange) patch.range = pool.inRange ? 'in' : 'out';
    }

    const borrowed = (position.tokens ?? []).filter((t) => t.role === 'borrow');
    if (borrowed.length) {
      const loans = facts.lending.filter((l) =>
        borrowed.some((leg) => leg.symbol.trim().toUpperCase() === l.token),
      );
      const loan = only(loans);
      if (loan) {
        if (position.healthRate == null) patch.healthRate = loan.healthFactor;
        // The protocols quote a percentage; a position stores the fraction
        if (position.borrowApy == null && loan.borrowRate !== null) {
          patch.borrowApy = loan.borrowRate / 100;
        }
      }
    }

    return Object.keys(patch).length ? { ...position, ...patch } : position;
  });
}
