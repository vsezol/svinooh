import { Decimal } from 'decimal.js';
import type { BuiltTransaction } from '../application/deposits';
import type { Landing } from '../domain/deposit';
import type { Catalog } from '../domain/catalog';
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
    ...(built.then ? { then: { pool_id: built.then.poolId, amount: built.then.amount } } : {}),
  };
}

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
