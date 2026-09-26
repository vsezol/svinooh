import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type {
  ReadLiquidityPositions,
  ReadPairPool,
  ReadPairPools,
} from '../../application/liquidity';
import type { LiquidityPosition, PairPool, PairToken } from '../../domain/liquidity';

/**
 * Meteora's own read API for DLMM: pools by name or address, and a wallet's
 * open positions with what each holds. No key, and no Solana node involved —
 * the same host the portfolio scanner reads positions from.
 */
const DATAPI = 'https://dlmm.datapi.meteora.ag';

const TIMEOUT_MS = 15_000;

/** How many pools of one pair are worth looking through: the rest hold next to nothing. */
const PAGE = 50;

/** How long a pool listing is taken as still true: rates and prices move, bins do not. */
const KEPT_MS = 60_000;

interface WireToken {
  address: string;
  symbol: string;
  decimals: number;
  is_verified?: boolean;
  price?: number;
}

interface WirePool {
  address: string;
  name: string;
  token_x: WireToken;
  token_y: WireToken;
  pool_config: { bin_step: number; base_fee_pct: number };
  tvl: number;
  current_price: number;
  volume?: Record<string, number>;
  fees?: Record<string, number>;
  protocol_fees?: Record<string, number>;
  is_blacklisted?: boolean;
}

const listed = new Map<string, { at: number; pools: PairPool[] }>();

class Refused extends Error {
  constructor(readonly status: number, route: string) {
    super(`meteora answered ${status} for ${route.split('?')[0]}`);
  }
}

async function asked<T>(route: string): Promise<T> {
  const answered = await fetch(`${DATAPI}${route}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!answered.ok) throw new Refused(answered.status, route);
  return (await answered.json()) as T;
}

const tokenOf = (wire: WireToken): PairToken => ({
  symbol: wire.symbol,
  mint: wire.address,
  decimals: wire.decimals,
  verified: wire.is_verified === true,
});

const dec = (value: number | string | undefined | null): Decimal => {
  try {
    return new Decimal(value ?? 0);
  } catch {
    return new Decimal(0);
  }
};

function poolOf(wire: WirePool): PairPool {
  return {
    id: { network: 'sol', protocol: 'meteora', kind: 'dlmm', address: wire.address },
    name: wire.name,
    x: tokenOf(wire.token_x),
    y: tokenOf(wire.token_y),
    binStep: wire.pool_config.bin_step,
    baseFeePct: dec(wire.pool_config.base_fee_pct),
    tvlUsd: dec(wire.tvl),
    volume24hUsd: dec(wire.volume?.['24h']),
    fees24hUsd: Decimal.max(dec(wire.fees?.['24h']).minus(dec(wire.protocol_fees?.['24h'])), 0),
    price: dec(wire.current_price),
    url: `https://app.meteora.ag/dlmm/${wire.address}`,
    yUsd: typeof wire.token_y.price === 'number' ? dec(wire.token_y.price) : null,
  };
}

/**
 * Pools answering to a pair's name, most money first. Asked both ways round:
 * Meteora names a pool by its own order of the two tokens, and somebody
 * asking for USDC-SOL means the pools it calls SOL-USDC. Blacklisted pools
 * are left out here; which pairs are worth offering is decided upstream.
 */
export const pairPoolsVia = (): ReadPairPools => async (first, second) => {
  const key = [first, second].map((one) => one.toLowerCase()).sort().join('/');
  const kept = listed.get(key);
  if (kept && kept.at > Date.now() - KEPT_MS) return kept.pools;
  const search = async (name: string) =>
    (
      await asked<{ data?: WirePool[] }>(
        `/pools?query=${encodeURIComponent(name)}&page=1&page_size=${PAGE}&sort_by=tvl:desc`,
      )
    ).data ?? [];
  const found = [...(await search(`${first}-${second}`)), ...(await search(`${second}-${first}`))];
  const unique = new Map(found.filter((one) => !one.is_blacklisted).map((one) => [one.address, one]));
  const pools = [...unique.values()].map(poolOf).sort((a, b) => b.tvlUsd.comparedTo(a.tvlUsd));
  listed.set(key, { at: Date.now(), pools });
  return pools;
};

export const pairPoolVia = (): ReadPairPool => async (address) => {
  try {
    const wire = await asked<WirePool>(`/pools/${encodeURIComponent(address)}`);
    return wire?.address ? poolOf(wire) : null;
  } catch (failure) {
    if (failure instanceof Refused && (failure.status === 404 || failure.status === 400)) return null;
    new Logger('Liquidity').warn(`pool ${address.slice(0, 6)}… could not be read: ${String(failure)}`);
    throw failure;
  }
};

interface WireOpenPool {
  poolAddress: string;
}

interface WireAmount {
  amount?: string;
  usd?: string;
}

interface WirePosition {
  positionAddress: string;
  minPrice?: string;
  maxPrice?: string;
  isOutOfRange?: boolean;
  isClosed?: boolean;
  unrealizedPnl?: {
    balances?: number | string;
    balanceTokenX?: WireAmount;
    balanceTokenY?: WireAmount;
    unclaimedFeeTokenX?: WireAmount;
    unclaimedFeeTokenY?: WireAmount;
  };
}

/**
 * A wallet's open positions, each with its pool: the pools it holds
 * positions in, then each pool asked about this owner's positions in it.
 */
export const liquidityPositionsVia =
  (readPool: ReadPairPool): ReadLiquidityPositions =>
  async (owner) => {
    const open = await asked<{ pools?: WireOpenPool[] }>(
      `/portfolio/open?user=${owner}&page=1&pageSize=100`,
    );
    const perPool = await Promise.all(
      (open.pools ?? []).map(async ({ poolAddress }) => {
        const [pool, answer] = await Promise.all([
          readPool(poolAddress),
          asked<{ positions?: WirePosition[] }>(
            `/positions/${poolAddress}/pnl?user=${owner}&page=1&pageSize=100`,
          ),
        ]);
        if (!pool) return [];
        return (answer.positions ?? [])
          .filter((one) => !one.isClosed)
          .map((one): LiquidityPosition => {
            const held = one.unrealizedPnl ?? {};
            return {
              address: one.positionAddress,
              pool,
              lowerPrice: dec(one.minPrice),
              upperPrice: dec(one.maxPrice),
              inRange: one.isOutOfRange !== true,
              amountX: dec(held.balanceTokenX?.amount),
              amountY: dec(held.balanceTokenY?.amount),
              valueUsd: dec(held.balances),
              feesUsd: dec(held.unclaimedFeeTokenX?.usd).plus(dec(held.unclaimedFeeTokenY?.usd)),
            };
          });
      }),
    );
    return perPool.flat();
  };
