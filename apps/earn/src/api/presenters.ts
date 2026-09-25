import { Decimal } from 'decimal.js';
import type { Holding } from '../application/coins';
import type { BuiltTransaction, Then } from '../application/deposits';
import type { PoolFit } from '../application/liquidity';
import type { Landing } from '../domain/deposit';
import type { Coin } from '../domain/move';
import type { Catalog } from '../domain/catalog';
import { feeApr, pairIdOf, type LiquidityPosition, type PairPool } from '../domain/liquidity';
import { isStale } from '../domain/catalog';
import { net, type Pool } from '../domain/pool';
import type { TokenYield } from '../domain/tokens';
import { idOf } from '../domain/values';
import type { Position } from '../domain/withdrawal';

const RATE_PLACES = 6;
const USD_PLACES = 2;
const AMOUNT_PLACES = 9;

const down = (value: Decimal | null, places: number): string | null =>
  value === null ? null : value.toFixed(places, Decimal.ROUND_DOWN);

export const rate = (value: Decimal | null): string | null => down(value, RATE_PLACES);
export const usd = (value: Decimal | null): string | null => down(value, USD_PLACES);
export const amount = (value: Decimal | null): string | null => down(value, AMOUNT_PLACES);

const required = (value: string | null): string => value ?? '0';

export const asOf = (moment: Date): string => moment.toISOString().replace('Z', '000Z');

export interface Meta {
  as_of: string;
  stale: boolean;
  catalog: number | null;
  degraded: string[];
  count: number | null;
  total: number | null;
  next_cursor: string | null;
}

export function meta(
  catalog: Catalog,
  now: Date,
  staleAfterMs: number,
  extra: Partial<Meta> = {},
): Meta {
  return {
    as_of: asOf(catalog.takenAt),
    stale: isStale(catalog, now, staleAfterMs),
    catalog: catalog.version,
    degraded: catalog.failedSources,
    count: null,
    total: null,
    next_cursor: null,
    ...extra,
  };
}

export const chainMeta = (now: Date): Meta => ({
  as_of: asOf(now),
  stale: false,
  catalog: null,
  degraded: [],
  count: null,
  total: null,
  next_cursor: null,
});

export function summary(pool: Pool) {
  return {
    id: idOf(pool.id),
    network: pool.id.network,
    protocol: pool.id.protocol,
    kind: pool.id.kind,
    name: pool.name,
    token: { symbol: pool.token.symbol, mint: pool.token.mint, decimals: pool.token.decimals },
    apy: {
      net: required(rate(net(pool.apy))),
      base: required(rate(pool.apy.base)),
      rewards: required(rate(pool.apy.rewards)),
      incentives: required(rate(pool.apy.incentives)),
    },
    tvl_usd: required(usd(pool.tvlUsd)),
    url: pool.url,
  };
}

export function detail(pool: Pool) {
  const windows = pool.apyWindows;
  return {
    ...summary(pool),
    apy_windows:
      windows === null
        ? null
        : {
            h24: rate(windows.h24),
            d7: rate(windows.d7),
            d30: rate(windows.d30),
            d90: rate(windows.d90),
            d365: rate(windows.d365),
          },
    fees:
      pool.fees === null
        ? null
        : { performance_bps: pool.fees.performanceBps, management_bps: pool.fees.managementBps },
    liquidity: {
      deposited: required(amount(pool.liquidity.deposited)),
      deposited_usd: required(usd(pool.liquidity.depositedUsd)),
      available: amount(pool.liquidity.available),
      available_usd: usd(pool.liquidity.availableUsd),
      utilization: rate(pool.liquidity.utilization),
    },
    deposit: {
      program_id: pool.deposit.programId,
      address: pool.deposit.address,
      min_amount: amount(pool.deposit.minAmount),
      shares_mint: pool.deposit.sharesMint,
      shares_decimals: pool.deposit.sharesDecimals,
      token_program: pool.deposit.tokenProgram,
      lending_market: pool.deposit.lendingMarket,
    },
    holders: pool.holders,
    borrow_apy: rate(pool.borrowApy),
    allocations: pool.allocations.map((allocation) => ({
      reserve: allocation.reserve,
      market: allocation.market,
      market_name: allocation.marketName,
      token_symbol: allocation.tokenSymbol,
      weight_pct: required(down(allocation.weightPct, USD_PLACES)),
    })),
  };
}

export function tokenYield(row: TokenYield) {
  return {
    symbol: row.tokenSymbol,
    mint: row.mint,
    decimals: row.decimals,
    network: row.best.id.network,
    pool_count: row.poolCount,
    best_apy: required(rate(net(row.best.apy))),
    best_pool_id: idOf(row.best.id),
    tvl_usd: required(usd(row.totalTvl)),
  };
}

export function builtTransaction(built: BuiltTransaction) {
  return {
    transaction: built.transaction,
    fee_payer: built.feePayer,
    instructions: built.instructions,
    blockhash: built.blockhash,
    last_valid_block_height: built.lastValidBlockHeight,
    ...(built.then ? { then: step(built.then) } : {}),
  };
}

const step = (then: Then) => {
  const wire: Record<string, string> = {
    action: then.action ?? '',
    pool_id: then.poolId ?? '',
    amount: then.amount ?? '',
    pay_with: then.payWith ?? '',
    receive_as: then.receiveAs ?? '',
    position: then.position ?? '',
    amount_x: then.amountX ?? '',
    amount_y: then.amountY ?? '',
    below_pct: then.belowPct ?? '',
    above_pct: then.abovePct ?? '',
    holding: then.holding,
  };
  return Object.fromEntries(Object.entries(wire).filter(([, value]) => value !== ''));
};

export function position(held: Position) {
  return {
    pool: summary(held.pool),
    shares: held.shares.toString(),
    amount: held.amount.toDecimalPlaces(held.pool.token.decimals ?? 6, Decimal.ROUND_DOWN).toString(),
  };
}

export function landing(seen: Landing) {
  return {
    signature: seen.signature,
    status: seen.status,
    slot: seen.slot,
    error: seen.error,
  };
}

export function holding(found: Holding) {
  return {
    coin: coin(found.coin),
    amount:
      found.amount === null
        ? null
        : found.amount.toDecimalPlaces(found.coin.decimals, Decimal.ROUND_DOWN).toFixed(),
  };
}

export function coin(found: Coin) {
  return {
    symbol: found.symbol,
    mint: found.mint,
    decimals: found.decimals,
    program: found.program,
  };
}

/** A price as it reads: enough places for a memecoin at a millionth of a cent, no trailing noise. */
const price = (value: Decimal): string => value.toSignificantDigits(10).toFixed();

export function pairPool(pool: PairPool) {
  const token = (one: PairPool['x']) => ({ symbol: one.symbol, mint: one.mint, decimals: one.decimals });
  return {
    id: pairIdOf(pool.id),
    name: pool.name,
    protocol: pool.id.protocol,
    kind: pool.id.kind,
    network: pool.id.network,
    x: token(pool.x),
    y: token(pool.y),
    bin_step: pool.binStep,
    base_fee_pct: pool.baseFeePct.toString(),
    tvl_usd: required(usd(pool.tvlUsd)),
    volume_24h_usd: required(usd(pool.volume24hUsd)),
    fees_24h_usd: required(usd(pool.fees24hUsd)),
    fee_apr: required(rate(feeApr(pool))),
    price: price(pool.price),
    url: pool.url,
  };
}

export const pairFit = (fit: PoolFit) => ({
  ...pairPool(fit.pool),
  range_bins: fit.bins,
  range_fits: fit.bins === null ? null : fit.why === null,
  why_not: fit.why,
});

export function liquidityPosition(held: LiquidityPosition) {
  return {
    address: held.address,
    pool: pairPool(held.pool),
    lower_price: price(held.lowerPrice),
    upper_price: price(held.upperPrice),
    in_range: held.inRange,
    amount_x: held.amountX.toDecimalPlaces(held.pool.x.decimals, Decimal.ROUND_DOWN).toFixed(),
    amount_y: held.amountY.toDecimalPlaces(held.pool.y.decimals, Decimal.ROUND_DOWN).toFixed(),
    value_usd: required(usd(held.valueUsd)),
    fees_usd: required(usd(held.feesUsd)),
  };
}
