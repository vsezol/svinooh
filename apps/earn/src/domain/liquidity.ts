import { Decimal } from 'decimal.js';

/**
 * Liquidity for a pair: two tokens in one pool, priced in bins, earning the
 * fees of every trade that crosses the bins a position holds. A different
 * product from lending — the money is two tokens at once, and it earns only
 * while the price stays inside the range it was placed in.
 */

export interface PairId {
  network: 'sol';
  protocol: 'meteora';
  kind: 'dlmm';
  address: string;
}

export const pairIdOf = (id: PairId): string =>
  `${id.network}:${id.protocol}:${id.kind}:${id.address}`;

export function parsePairId(raw: string): PairId | null {
  const [network, protocol, kind, address, ...rest] = raw.split(':');
  if (rest.length || network !== 'sol' || protocol !== 'meteora' || kind !== 'dlmm' || !address) {
    return null;
  }
  return { network, protocol, kind, address };
}

export interface PairToken {
  symbol: string;
  mint: string;
  decimals: number;
  verified: boolean;
}

/**
 * A Meteora DLMM pool. `x` is the token the price is of and `y` the one it is
 * in: `price` is how much y one x costs. `binStep` is how far apart two
 * neighbouring bins are priced, in basis points — 80 is 0.8% a bin.
 * `fees24hUsd` is what liquidity providers were paid over the last day, the
 * protocol's share taken out.
 */
export interface PairPool {
  id: PairId;
  name: string;
  x: PairToken;
  y: PairToken;
  binStep: number;
  baseFeePct: Decimal;
  tvlUsd: Decimal;
  volume24hUsd: Decimal;
  fees24hUsd: Decimal;
  price: Decimal;
  url: string;
  yUsd?: Decimal | null;
}

/**
 * A year of the last day's fees on the money in the pool: a rate only as
 * steady as the trading behind it, and paid only to liquidity inside the
 * price's range.
 */
export const feeApr = (pool: PairPool): Decimal =>
  pool.tvlUsd.isZero() ? new Decimal(0) : pool.fees24hUsd.div(pool.tvlUsd).mul(365);

/**
 * Prices around the current one, as fractions of it: `below` 0.103 reaches
 * down to 10.3% under the price, `above` 0.055 up to 5.5% over it.
 */
export interface Range {
  below: Decimal;
  above: Decimal;
}

/** The bins one position holds, and one transaction fills. */
export const MAX_BINS = 70;

export const percentOf = (fraction: Decimal): string => fraction.mul(100).toDecimalPlaces(4).toFixed();

/** Where a range sits among a pool's bins: offsets from the active bin, and how many it spans. */
export interface Span {
  lower: number;
  upper: number;
  bins: number;
}

export function spanOf(range: Range, binStep: number): Span {
  const step = Math.log(1 + binStep / 10_000);
  const lower = Math.floor(Math.log(1 - range.below.toNumber()) / step);
  const upper = Math.ceil(Math.log(1 + range.above.toNumber()) / step);
  return { lower, upper, bins: upper - lower + 1 };
}

/** The widest range, as far down as up, that one position of a pool with these bins holds. */
export function widestEven(binStep: number): Decimal {
  const each = Math.floor((MAX_BINS - 1) / 2);
  return new Decimal(1 + binStep / 10_000).pow(each).minus(1).toDecimalPlaces(4, Decimal.ROUND_DOWN);
}

const percent = (fraction: Decimal): string => `${fraction.mul(100).toDecimalPlaces(2).toString()}%`;

/** Why a range cannot be one position in this pool, or null when it can. */
export function whyNotRange(range: Range, pool: PairPool): string | null {
  if (range.below.isNegative() || range.above.isNegative()) {
    return 'a range reaches down from the price and up from it, by a share of it each way';
  }
  if (range.below.gte(1)) return 'a range cannot reach 100% or more below the price';
  if (range.below.isZero() && range.above.isZero()) return 'a range has to have some width';
  const span = spanOf(range, pool.binStep);
  if (span.bins > MAX_BINS) {
    return (
      `${percent(range.below)} below and ${percent(range.above)} above is ${span.bins} of ` +
      `${pool.name}'s bins, ${pool.binStep / 100}% each; one position holds ${MAX_BINS}, about ` +
      `${percent(widestEven(pool.binStep))} each way here. A pool of the pair with wider bins ` +
      'holds this range'
    );
  }
  return null;
}

/** The two prices a range reaches from the current one. */
export function pricesOf(range: Range, price: Decimal): { lower: Decimal; upper: Decimal } {
  return {
    lower: price.mul(new Decimal(1).minus(range.below)),
    upper: price.mul(new Decimal(1).plus(range.above)),
  };
}

/**
 * A position in a pair pool, as its owner holds it: the range it was placed
 * in, where the price is now, and what it holds of each token.
 */
export interface LiquidityPosition {
  address: string;
  pool: PairPool;
  lowerPrice: Decimal;
  upperPrice: Decimal;
  inRange: boolean;
  amountX: Decimal;
  amountY: Decimal;
  valueUsd: Decimal;
  feesUsd: Decimal;
}

/** Whether both tokens of a pool are ones a directory has verified: a ticker alone proves nothing. */
export const trusted = (pool: PairPool): boolean => pool.x.verified && pool.y.verified;

/** Whether a pool pairs these two tokens, by ticker or mint, in either order. */
export function pairs(pool: PairPool, first: string, second: string): boolean {
  const names = (token: PairToken) => [token.symbol.toLowerCase(), token.mint];
  const is = (token: PairToken, asked: string) =>
    names(token).includes(asked) || names(token).includes(asked.toLowerCase());
  return (
    (is(pool.x, first) && is(pool.y, second)) || (is(pool.x, second) && is(pool.y, first))
  );
}

/** Liquidity to place in a pool: what of each token goes in, and the range around the price. */
export interface Provide {
  pool: PairPool;
  owner: string;
  amountX: Decimal;
  amountY: Decimal;
  range: Range;
}

/** A position emptied, its fees claimed and its account closed, so its rent comes back too. */
export interface Close {
  position: string;
  owner: string;
}

/**
 * A position closed and what comes back placed again around the price: in
 * `range`, or — with none given — in as many bins as it held, as far down as up.
 */
export interface Rebalance {
  position: string;
  owner: string;
  range: Range | null;
}

/** A difference too small to be worth a swap, as a share of all that goes in. */
const SWAP_WHISKER = new Decimal('0.005');

export type Balance = { swap: null } | { swap: 'x' | 'y'; amount: Decimal };

/**
 * How much of one token to swap for the other so that what goes in fills the
 * range evenly: every bin under the price holds y, every bin over it holds x.
 * `ratio` is how much y a unit of x brings along across the range at the
 * pool's `price` (y per x); `swap: 'x'` is that much x to swap into y.
 */
export function balance(amountX: Decimal, amountY: Decimal, price: Decimal, ratio: Decimal): Balance {
  const value = amountX.mul(price).plus(amountY);
  if (value.lte(0)) return { swap: null };
  const x = value.div(price.plus(ratio));
  const y = x.mul(ratio);
  const whisker = value.mul(SWAP_WHISKER);
  if (amountX.minus(x).mul(price).gt(whisker)) return { swap: 'x', amount: amountX.minus(x) };
  if (amountY.minus(y).gt(whisker)) return { swap: 'y', amount: amountY.minus(y) };
  return { swap: null };
}

/** A range as far down as up, the width of so many bins of a pool. */
export function evenRange(bins: number, binStep: number): Range {
  const each = Math.floor((bins - 1) / 2);
  const step = 1 + binStep / 10_000;
  return {
    below: new Decimal(1).minus(new Decimal(step).pow(-each)).toDecimalPlaces(6, Decimal.ROUND_DOWN),
    above: new Decimal(step).pow(each).minus(1).toDecimalPlaces(6, Decimal.ROUND_DOWN),
  };
}
