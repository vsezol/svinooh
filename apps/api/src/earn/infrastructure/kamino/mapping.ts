import { Decimal } from 'decimal.js';
import type { Allocation, Pool } from '../../domain/pool';
import type {
  AllocationPayload,
  MarketReserves,
  ReserveMetricsPayload,
  VaultMetricsPayload,
  VaultPayload,
} from './api';

export const KVAULT_PROGRAM = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd';
export const KLEND_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
export const APP = 'https://kamino.com';

const ZERO = new Decimal(0);

export function toDecimal(value: unknown, fallback: Decimal | null = ZERO): Decimal | null {
  if (value === null || value === undefined) return fallback;
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const num = (value: unknown): Decimal => toDecimal(value) ?? ZERO;
const orNull = (value: unknown): Decimal | null => toDecimal(value, null);
const intOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

export interface Index {
  symbols: Map<string, string>;
  decimals: Map<string, number>;
  marketNames: Map<string, string>;
  reserveMarkets: Map<string, string>;
  reserveTokens: Map<string, string>;
}

export function buildIndex(vaults: VaultPayload[], perMarket: MarketReserves[]): Index {
  const index: Index = {
    symbols: new Map(),
    decimals: new Map(),
    marketNames: new Map(),
    reserveMarkets: new Map(),
    reserveTokens: new Map(),
  };
  for (const entry of perMarket) {
    index.marketNames.set(entry.market, entry.name);
    for (const reserve of entry.reserves) {
      const mint = reserve.liquidityTokenMint;
      const address = reserve.reserve;
      const ticker = (reserve.liquidityToken ?? '').toUpperCase();
      if (mint && ticker && !index.symbols.has(mint)) index.symbols.set(mint, ticker);
      if (address) {
        index.reserveMarkets.set(address, entry.market);
        index.reserveTokens.set(address, ticker || '?');
      }
    }
  }
  for (const vault of vaults) {
    const state = vault.state ?? {};
    const mint = state.tokenMint;
    const decimals = state.tokenMintDecimals;
    if (mint && Number.isInteger(decimals) && !index.decimals.has(mint)) {
      index.decimals.set(mint, decimals as number);
    }
  }
  return index;
}

export function vaultToPool(
  vault: VaultPayload,
  metrics: VaultMetricsPayload,
  index: Index,
): Pool | null {
  const state = vault.state ?? {};
  const address = vault.address;
  const mint = state.tokenMint;
  if (!address || !mint) return null;

  const investedUsd = num(metrics.tokensInvestedUsd);
  const availableUsd = num(metrics.tokensAvailableUsd);
  const decimals = state.tokenMintDecimals;

  return {
    id: { network: 'sol', protocol: 'kamino', kind: 'vault', address },
    name: (state.name ?? '').trim() || `Kamino vault ${address.slice(0, 8)}`,
    token: {
      symbol: index.symbols.get(mint) ?? '?',
      mint,
      decimals: Number.isInteger(decimals) ? (decimals as number) : null,
    },
    apy: {
      base: num(metrics.apy),
      rewards: num(metrics.apyFarmRewards),
      incentives: num(metrics.apyIncentives).plus(num(metrics.apyReservesIncentives)),
    },
    tvlUsd: investedUsd.plus(availableUsd),
    liquidity: {
      deposited: num(metrics.tokensInvested).plus(num(metrics.tokensAvailable)),
      depositedUsd: investedUsd.plus(availableUsd),
      available: num(metrics.tokensAvailable),
      availableUsd,
      utilization: null,
    },
    deposit: {
      programId: vault.programId || KVAULT_PROGRAM,
      address,
      minAmount: minDeposit(state.minDepositAmount, decimals),
      sharesMint: state.sharesMint ?? null,
      sharesDecimals: state.sharesMintDecimals ?? null,
      tokenProgram: state.tokenProgram ?? null,
      lendingMarket: null,
      farm: farmOf(state.vaultFarm),
    },
    url: `${APP}/earn/lend/${address}`,
    apyWindows: {
      h24: orNull(metrics.apy24h),
      d7: orNull(metrics.apy7d),
      d30: orNull(metrics.apy30d),
      d90: orNull(metrics.apy90d),
      d365: orNull(metrics.apy365d),
    },
    fees: {
      performanceBps: Number(state.performanceFeeBps ?? 0),
      managementBps: Number(state.managementFeeBps ?? 0),
    },
    holders: intOrNull(metrics.numberOfHolders),
    borrowApy: null,
    allocations: allocationsOf(state.vaultAllocationStrategy ?? [], index),
  };
}

export function reserveToPool(
  reserve: ReserveMetricsPayload,
  market: string,
  marketName: string,
  index: Index,
): Pool | null {
  const address = reserve.reserve;
  const mint = reserve.liquidityTokenMint;
  if (!address || !mint) return null;

  const supplied = num(reserve.totalSupply);
  const borrowed = num(reserve.totalBorrow);
  const symbol = (reserve.liquidityToken ?? '?').toUpperCase();
  const suppliedUsd = num(reserve.totalSupplyUsd);

  return {
    id: { network: 'sol', protocol: 'kamino', kind: 'reserve', address },
    name: `${symbol} · ${marketName}`,
    token: { symbol, mint, decimals: index.decimals.get(mint) ?? null },
    apy: { base: num(reserve.supplyApy), rewards: ZERO, incentives: ZERO },
    tvlUsd: suppliedUsd,
    liquidity: {
      deposited: supplied,
      depositedUsd: suppliedUsd,
      available: supplied.minus(borrowed),
      availableUsd: null,
      utilization: supplied.greaterThan(0) ? borrowed.dividedBy(supplied) : ZERO,
    },
    deposit: {
      programId: KLEND_PROGRAM,
      address,
      minAmount: null,
      sharesMint: null,
      sharesDecimals: null,
      tokenProgram: null,
      lendingMarket: market,
      farm: null,
    },
    url: `${APP}/borrow/reserve/${market}/${address}`,
    apyWindows: null,
    fees: null,
    holders: null,
    borrowApy: num(reserve.borrowApy),
    allocations: [],
  };
}

function allocationsOf(raw: AllocationPayload[], index: Index): Allocation[] {
  const live = raw
    .map((entry) => ({ reserve: entry.reserve, weight: num(entry.targetAllocationWeight) }))
    .filter((entry): entry is { reserve: string; weight: Decimal } =>
      Boolean(entry.reserve && entry.weight.greaterThan(0)),
    );
  const total = live.reduce((sum, entry) => sum.plus(entry.weight), ZERO);
  return live.map((entry) => {
    const market = index.reserveMarkets.get(entry.reserve) ?? '';
    return {
      reserve: entry.reserve,
      market,
      marketName: index.marketNames.get(market) ?? '',
      tokenSymbol: index.reserveTokens.get(entry.reserve) ?? '?',
      weightPct: total.greaterThan(0) ? entry.weight.dividedBy(total).times(100) : ZERO,
    };
  });
}

function minDeposit(raw: unknown, decimals: unknown): Decimal | null {
  const amount = toDecimal(raw, null);
  if (amount === null || amount.lessThan(0) || !Number.isInteger(decimals)) return null;
  return amount.dividedBy(new Decimal(10).pow(decimals as number));
}

const NO_FARM = '11111111111111111111111111111111';

const farmOf = (farm: string | undefined): string | null =>
  farm && farm !== NO_FARM ? farm : null;
