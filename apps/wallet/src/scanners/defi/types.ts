/**
 * What a protocol's own API knows about a position that the aggregator does not.
 *
 * These never become positions. Jupiter and DeBank decide what a wallet holds
 * and what it is worth; an adapter only answers questions they left blank —
 * whether a concentrated-liquidity position is actually in its band, and what
 * the band is. A protocol that disagrees about value is not consulted about it.
 */
export interface PoolFact {
  /** Stable across cycles: the protocol's own address for this position */
  id: string;
  platform: 'orca' | 'meteora' | 'uniswap';
  /** The pair, upper-cased and ordered, e.g. "CBBTC|USDC" — how a fact finds its position */
  pair: string;
  inRange: boolean;
  lowerPrice: number;
  upperPrice: number;
  currentPrice: number;
  /** "USDC per cbBTC" */
  priceLabel: string;
  isFullRange: boolean;
}

/** What a lending market says about a loan, per borrowed asset */
export interface LendingFact {
  id: string;
  platform: 'kamino' | 'aave';
  market: string;
  /** Upper-cased symbol of the borrowed asset — how a fact finds its position */
  token: string;
  healthFactor: number;
  /** Borrow APY as a percentage: 6.2 is 6.2% */
  borrowRate: number | null;
}

/**
 * Everything the adapters could see this cycle, and which of them could not
 * see anything.
 *
 * `failed` matters as much as the facts: a source that threw has told us
 * nothing, and nothing is not the same as "no positions". A caller that treats
 * the two alike will report every position of a temporarily unreachable
 * protocol as gone.
 */
export interface DefiFacts {
  pools: PoolFact[];
  lending: LendingFact[];
  /** Sources that could not be reached, by platform */
  failed: string[];
}

export const NO_FACTS: DefiFacts = { pools: [], lending: [], failed: [] };

/** How a pair is written so two spellings of the same pool still meet */
export function pairKey(a: string | null | undefined, b: string | null | undefined): string {
  return [a ?? '', b ?? '']
    .map((s) => s.trim().toUpperCase())
    .sort()
    .join('|');
}
