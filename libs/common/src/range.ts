import type { PositionRange } from '@svinooh/shared';
import type { ScanPositionToken } from '@svinooh/shared';

/**
 * Whether a concentrated-liquidity position is still in range.
 *
 * DERIVED, not reported: neither DeBank nor Jupiter exposes a range flag. It
 * follows from how concentrated liquidity works — inside its band a position
 * holds both sides of the pair, and once the price crosses a bound it is
 * converted entirely into one side and stops earning fees. A single-sided
 * position is therefore out of range by definition, which is also exactly how a
 * one-sided "limit order" position behaves.
 *
 * Only ever call this for positions that actually have a range (see the callers:
 * DeBank marks them with `position_index`, Jupiter names them DLMM/CLMM/
 * Whirlpool). On a full-range V2-style pool the answer would always be "in",
 * which is true but meaningless — and a meaningless badge is worse than none.
 */
const EMPTY_SIDE = 0.005; // a side under 0.5% of the position has effectively been converted away

/** "Liquidity Pool", "LP", "Concentrated Liquidity" — and nothing else */
const RANGED_KIND = /pool|liquidity|\blp\b/i;

/**
 * Does a position of this KIND have a range at all?
 *
 * Only a two-sided pool position does. Lending, staking, deposits and yield
 * vaults hold one asset because that is what they are, not because a price
 * moved — and "out of range" said about one of those is not a small wrongness,
 * it is a sentence about liquidation risk that has no meaning there.
 *
 * This used to be enforced by accident. The range inference bailed out unless
 * it saw exactly two supplied legs, which quietly filtered out everything that
 * holds one asset — until the day the single-legged case became answerable and
 * the accident stopped covering for the missing check.
 */
export function hasRange(kind: string | null | undefined): boolean {
  return !!kind && RANGED_KIND.test(kind);
}

export function rangeFromLegs(legs: ScanPositionToken[]): PositionRange | null {
  const supplied = legs.filter((leg) => leg.role === 'supply');
  // One side and nothing else: the price crossed a bound and the position has
  // been converted whole into the token it is now holding. That is the state
  // the paragraph above defines as out of range — and it is the state the old
  // `!== 2` guard threw away, because a source reporting a position that holds
  // one token reports one leg, not two with a zero. Which is to say this
  // function refused to answer in exactly the case it exists to answer.
  if (supplied.length === 1) return 'out';
  if (supplied.length !== 2) return null; // not a pair — we can't tell, so we don't guess
  const values = supplied.map((leg) => Math.abs(leg.valueUsd));
  const total = values[0] + values[1];
  if (total <= 0) return null;
  return Math.min(...values) / total < EMPTY_SIDE ? 'out' : 'in';
}
