import type { DefiFacts, PoolFact, ScanPosition } from '@svinooh/shared';
import { hasRange } from './range';

/** Nothing was asked, or nothing answered — either way there is nothing to fill in */
export const NO_FACTS: DefiFacts = { pools: [], lending: [], failed: [] };

/** How a pair is written so two spellings of the same pool still meet */
export function pairKey(a: string | null | undefined, b: string | null | undefined): string {
  return [a ?? '', b ?? '']
    .map((s) => s.trim().toUpperCase())
    .sort()
    .join('|');
}

/**
 * Any loan at all.
 *
 * This used to ask only for loans the aggregator described incompletely — no
 * health, or no rate — on the theory that a present number is a good number.
 * Then a present number was checked against the protocol it claimed to be
 * from: Jupiter priced a Kamino USDT loan at 7.8% APR while Kamino's own API,
 * the owner's day of accrued interest, and Kamino's own interface all said
 * 5.0%. A rate the protocol can contradict is worth two requests to verify,
 * so the facts are fetched whenever there is a loan to verify at all.
 */
export function needsLendingFacts(positions: ScanPosition[]): boolean {
  return positions.some((position) => {
    const legs = position.tokens ?? [];
    if (legs.some((t) => t.role === 'borrow')) return true;
    if (!LENDING_LABEL.test(position.name ?? '')) return false;
    return ASKABLE.test(`${position.platform ?? ''} ${position.symbol ?? ''}`) &&
      legs.some((t) => t.role === 'supply');
  });
}

export function rateFromAggregator(element: {
  label: string | null;
  netApy: number | null;
  borrowed: number;
  supplied: number;
}): number | null {
  if (typeof element.netApy !== 'number' || element.netApy === 0) return null;
  if (element.borrowed > 0) return null;
  if (!LENDING_LABEL.test(element.label ?? '')) return element.netApy;
  return element.supplied === 1 ? element.netApy : null;
}

const LENDING_LABEL = /lend|borrow|leverage/i;

const ASKABLE = /kamino|aave/i;

/** The pair a position is made of, or null when it isn't a pair at all */
function pairOf(position: ScanPosition): string | null {
  const legs = position.tokens ?? [];
  const supplied = legs.filter((t) => t.role === 'supply');
  if (supplied.length === 2) return pairKey(supplied[0].symbol, supplied[1].symbol);

  // A position that has crossed a bound holds one token, so the pair can no
  // longer be read off what it is holding — which lost the band for precisely
  // the positions whose band is worth looking at. Its uncollected fees still
  // name both sides, because fees accrue in the pool's own two tokens, so they
  // finish the pair.
  //
  // Pools only. A lending position supplying one asset and earning a reward in
  // another also has two symbols on it, and they are not a pair.
  if (!hasRange(position.name)) return null;
  const symbols = [...new Set(legs.map((t) => t.symbol.trim().toUpperCase()))];
  return symbols.length === 2 ? pairKey(symbols[0], symbols[1]) : null;
}

/**
 * The fact that names itself the way this position does.
 *
 * Tried before the pair, because it is the only one of the two that is an
 * identity. Two positions in one pool are two rows with the same pair, and the
 * pair was all a fact was ever matched by — so a wallet holding two ranges in
 * USDC/WETH got a band for neither. It also does not care what the position is
 * currently holding, which is what makes it work for a position that has been
 * converted to one token and has no fees to name the other side with.
 *
 * Returns nothing when the ids do not line up, and the pair is tried next — so
 * this can only ever resolve an ambiguity, never create one.
 */
function byRef(pools: PoolFact[], position: ScanPosition): PoolFact | null {
  const ref = position.ref?.trim();
  if (!ref) return null;
  return only(pools.filter((p) => p.ref && p.ref.trim() === ref));
}

/**
 * The one fact of this pair that does not name a position of its own.
 *
 * Asked after the id and never for a fact that carries one: a fact that says
 * which position it is has already been offered to the position that says the
 * same, and reaching here means that was not this one. Where neither side has
 * an id — the protocols that have none to give — the pair is all there is.
 *
 * Even then it answers only where exactly one fact can be meant. A pair is not
 * an identity: two positions in one pool are two rows with the same pair, and a
 * confidently wrong band on somebody's money is worse than an absent one.
 */
function byPair(pools: PoolFact[], pair: string): PoolFact | null {
  return only(pools.filter((p) => !p.ref && p.pair === pair));
}

/**
 * The facts this position's own protocol produced, and nobody else's.
 *
 * A fact is one protocol reading one of its own positions, so a position of
 * another protocol is not something it can describe. Without this the match
 * came down to the pair, and a pair is not an identity: a concentrated pool's
 * band was handed to a position on another network, of a protocol whose
 * positions have no band at all, because the two held the same two tokens.
 *
 * The fact's own name is looked for INSIDE what the position says it is, since
 * every source writes a protocol its own way: an aggregator's project id
 * (`base_uniswap3`), a display name (`Uniswap V3`), a bare id (`kamino`).
 */
function ofProtocol<T extends { platform: string }>(facts: T[], position: ScanPosition): T[] {
  const said = `${position.platform ?? ''} ${position.symbol ?? ''}`.toLowerCase();
  return facts.filter((fact) => said.includes(fact.platform));
}

function inMarketOf<T extends { market: string }>(facts: T[], position: ScanPosition): T[] {
  const named = (position.note ?? '').trim().toLowerCase();
  if (!named) return facts;
  const sameMarket = facts.filter((fact) => fact.market.trim().toLowerCase() === named);
  return sameMarket.length ? sameMarket : facts;
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
 * It also attaches `band` and `loan`, which change nothing about the position
 * and are there to be read: they are what lets an alert say how far out of
 * range a position went and which way, instead of only that it went.
 *
 * A fact is only ever matched to a position of the protocol it came from. Among
 * those, a pool position is matched by its own id where the fact has one and by
 * its pair where the protocol has none to give; a loan by the asset it borrowed.
 * Only the id is an identity, so where the pair is all there is, a match is used
 * only when exactly one fact can be about this position — a wallet with two
 * positions in the same pool and no ids to tell them apart gets the inference it
 * had before rather than a coin-flip between two bands, because a confidently
 * wrong range on somebody's money is worse than an approximate one.
 */
export function enrich(positions: ScanPosition[], facts: DefiFacts): ScanPosition[] {
  if (!facts.pools.length && !facts.lending.length && !facts.supply?.length) return positions;

  return positions.map((position) => {
    const patch: Partial<ScanPosition> = {};

    // Its own protocol first; then its own id where the fact has one, its pair
    // where the protocol has no id to give
    const pair = pairOf(position);
    const pools = ofProtocol(facts.pools, position);
    const pool = byRef(pools, position) ?? (pair ? byPair(pools, pair) : null);

    // A full-range position has no band to be outside of, and saying "in
    // range" of a pool that spans every price is a badge that means nothing
    if (pool && !pool.isFullRange) {
      patch.range = pool.inRange ? 'in' : 'out';
      patch.band = {
        pair: pool.pairLabel,
        feePct: pool.feePct,
        chainLabel: pool.chainLabel,
        lower: pool.lowerPrice,
        upper: pool.upperPrice,
        current: pool.currentPrice,
        priceLabel: pool.priceLabel,
      };
    }

    const borrowed = (position.tokens ?? []).filter((t) => t.role === 'borrow');
    if (borrowed.length) {
      const loans = ofProtocol(facts.lending, position).filter((l) =>
        borrowed.some((leg) => leg.symbol.trim().toUpperCase() === l.token),
      );
      const loan = only(loans);
      if (loan) {
        // Named whatever the aggregator already knew about health and rate: the
        // market and the asset are the same market and asset either way, and a
        // message that can say "USDC · Main Market" should not go without
        // because DeBank happened to report the health factor first
        patch.loan = { market: loan.market, token: loan.token };
        if (position.healthRate == null) patch.healthRate = loan.healthFactor;
        const before = position.tokens ?? [];
        let tokens = before;
        // The rate REPLACES the aggregator's, the same way a pool's own tick
        // replaces the inferred range: what a loan costs is the lending
        // protocol's own number, and the one time the two were compared the
        // aggregator was 2.7 points high on it. The protocols quote a
        // percentage; a position stores the fraction.
        if (loan.borrowRate !== null) {
          const rate = loan.borrowRate / 100;
          patch.borrowApy = rate;
          // The borrowed LEG carries its own rate too — it is what the row's
          // "USDT · 8.1%" label is printed from — so it takes the same truth
          tokens = tokens.map((t) =>
            t.role === 'borrow' && t.symbol.trim().toUpperCase() === loan.token
              ? { ...t, apy: rate }
              : t,
          );
        }
        const supplied = loan.supplyRates;
        if (supplied) {
          tokens = tokens.map((t) => {
            const rate = supplied[t.symbol.trim().toUpperCase()];
            return t.role === 'supply' && typeof rate === 'number' ? { ...t, apy: rate / 100 } : t;
          });
        }
        if (tokens !== before) patch.tokens = tokens;
      }
    }

    const supplied = (position.tokens ?? []).filter((t) => t.role === 'supply');
    if (!borrowed.length && supplied.length) {
      const supplying = only(inMarketOf(ofProtocol(facts.supply ?? [], position), position));
      if (supplying) {
        const before = position.tokens ?? [];
        let changed = false;
        const tokens = before.map((leg) => {
          const rate = supplying.rates[leg.symbol.trim().toUpperCase()];
          if (leg.role !== 'supply' || typeof rate !== 'number') return leg;
          changed = true;
          return { ...leg, apy: rate / 100 };
        });
        if (changed) patch.tokens = tokens;
        const alone = supplied.length === 1 ? supplying.rates[supplied[0].symbol.trim().toUpperCase()] : undefined;
        if (typeof alone === 'number') patch.apy = alone / 100;
      }
    }

    return Object.keys(patch).length ? { ...position, ...patch } : position;
  });
}
