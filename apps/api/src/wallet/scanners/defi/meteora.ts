import { fetchJson } from '../http';
import type { PoolFact } from '@svinooh/shared';
import { pairKey } from '@svinooh/common';

/**
 * Meteora DLMM through the datapi host — no Solana RPC involved, and the prices
 * arrive in human units already (token Y per token X). Two hops: the open
 * portfolio lists the pools a wallet has positions in, then each pool is asked
 * about the positions themselves.
 *
 * Not `dlmm-api.meteora.ag`, which answers 404 for these paths.
 */
const DLMM_API = 'https://dlmm.datapi.meteora.ag';
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

interface Paged<T> {
  hasNext?: boolean;
  pools?: T[];
  positions?: T[];
}

interface MeteoraPool {
  poolAddress: string;
  tokenX?: string;
  tokenY?: string;
  tokenXMint?: string;
  tokenYMint?: string;
  baseFee?: number;
  /** Current USD value of everything the wallet has in this pool — what the UI shows */
  balances?: number | string;
  unclaimedFees?: number | string;
  outOfRange?: boolean;
}

/** One pool the wallet holds, as its own line — value and range straight from Meteora */
export interface MeteoraPoolPosition {
  poolAddress: string;
  pairLabel: string;
  tokenX: string;
  tokenY: string;
  valueUsd: number;
  feesUsd: number;
  inRange: boolean;
}

interface MeteoraPosition {
  positionAddress: string;
  isClosed?: boolean;
  isOutOfRange?: boolean;
  minPrice?: number | string;
  maxPrice?: number | string;
  poolActivePrice?: number | string;
  /** The bins the position was opened between — the same range the prices describe */
  lowerBinId?: number;
  upperBinId?: number;
  /** Where the pool's price stands, as a bin */
  poolActiveBinId?: number;
}

/**
 * One position, as something to watch on-chain rather than to draw.
 *
 * The prices are what a person reads; the BINS are what the pool itself is
 * written in, and they are what makes a live answer possible. A DLMM pool's
 * account carries one number that matters here — the active bin — so a
 * position is in range exactly while that number is between these two, and
 * that is a comparison of integers with nothing to convert and nothing to
 * round. See `apps/api/src/wallet/live`.
 */
export interface MeteoraWatchable {
  poolAddress: string;
  positionAddress: string;
  pairLabel: string;
  lowerBinId: number;
  upperBinId: number;
  /** As Meteora saw it when it answered — the baseline until the chain says otherwise */
  activeBinId: number;
  inRange: boolean;
  /**
   * The same two ends as prices — exactly the numbers the scan stores as this
   * position's band, which is how a stored row is recognised as this position.
   */
  lowerPrice: number;
  upperPrice: number;
}

async function paged<T>(path: string, key: 'pools' | 'positions'): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await fetchJson<Paged<T>>(`${DLMM_API}${path}${sep}page=${page}&pageSize=${PAGE_SIZE}`);
    items.push(...((data[key] as T[] | undefined) ?? []));
    if (!data.hasNext) break;
  }
  return items;
}

/**
 * A DLMM position is a range of bins and is never full-range, so `isOutOfRange`
 * is the protocol's own answer to the only question worth asking. Closed
 * positions are dropped: an empty position is not one that left its range.
 */
export async function meteoraPools(address: string): Promise<PoolFact[]> {
  const pools = await paged<MeteoraPool>(`/portfolio/open?user=${address}`, 'pools');
  if (!pools.length) return [];

  const perPool = await Promise.all(
    pools.map(async (pool) => {
      const symX = pool.tokenX || (pool.tokenXMint ?? '').slice(0, 4);
      const symY = pool.tokenY || (pool.tokenYMint ?? '').slice(0, 4);
      const positions = await paged<MeteoraPosition>(
        `/positions/${pool.poolAddress}/pnl?user=${address}`,
        'positions',
      );
      return positions
        .filter((p) => !p.isClosed)
        .map((p) => ({
          id: `meteora:${p.positionAddress}`,
          ref: p.positionAddress,
          pool: pool.poolAddress,
          platform: 'meteora' as const,
          pair: pairKey(symX, symY),
          pairLabel: `${symX}/${symY}`,
          // Already a percentage on this API — 0.04 is the 0.04% pool
          feePct: typeof pool.baseFee === 'number' ? pool.baseFee : null,
          chainLabel: 'Solana',
          inRange: !p.isOutOfRange,
          lowerPrice: Number(p.minPrice),
          upperPrice: Number(p.maxPrice),
          currentPrice: Number(p.poolActivePrice),
          priceLabel: `${symY} per ${symX}`,
          isFullRange: false,
        }));
    }),
  );
  return perPool.flat();
}

/**
 * The wallet's Meteora pools, one entry each, with the value and range Meteora
 * itself reports (the same `balances` the DLMM UI shows).
 *
 * Jupiter aggregates every Meteora pool a wallet holds into a single element, so
 * two pools arrive as one position. This is the per-pool truth the caller uses
 * to break that one position back into the several it really is. A single hop —
 * `/portfolio/open` already carries value, fees and out-of-range per pool, so no
 * per-position round trip is needed here.
 */
export async function meteoraPositions(address: string): Promise<MeteoraPoolPosition[]> {
  const pools = await paged<MeteoraPool>(`/portfolio/open?user=${address}`, 'pools');
  return pools
    .map((pool) => {
      const tokenX = pool.tokenX || (pool.tokenXMint ?? '').slice(0, 4);
      const tokenY = pool.tokenY || (pool.tokenYMint ?? '').slice(0, 4);
      return {
        poolAddress: pool.poolAddress,
        pairLabel: `${tokenX}/${tokenY}`,
        tokenX,
        tokenY,
        valueUsd: Number(pool.balances) || 0,
        feesUsd: Number(pool.unclaimedFees) || 0,
        inRange: !pool.outOfRange,
      };
    })
    .filter((p) => p.valueUsd > 0.01);
}

/**
 * The wallet's open positions in the bins they were opened between.
 *
 * The same two hops as the rest of this file, and the numbers come from the
 * same answer — Meteora reports `lowerBinId`/`upperBinId` beside the prices,
 * so nothing is derived and nothing is converted. A position missing either
 * of them is dropped rather than guessed at: what this feeds decides whether
 * somebody is woken up.
 *
 * `inRange` is Meteora's own verdict, kept as the baseline the live watch
 * starts from — and, because it is computed here the same way the watch will
 * compute it, a position whose two answers disagree is one whose bins we have
 * read wrong, and it is dropped too.
 */
export async function meteoraWatchables(address: string): Promise<MeteoraWatchable[]> {
  const pools = await paged<MeteoraPool>(`/portfolio/open?user=${address}`, 'pools');
  if (!pools.length) return [];

  const perPool = await Promise.all(
    pools.map(async (pool) => {
      const symX = pool.tokenX || (pool.tokenXMint ?? '').slice(0, 4);
      const symY = pool.tokenY || (pool.tokenYMint ?? '').slice(0, 4);
      const positions = await paged<MeteoraPosition>(
        `/positions/${pool.poolAddress}/pnl?user=${address}`,
        'positions',
      );
      return positions
        .filter(
          (p) =>
            !p.isClosed &&
            typeof p.lowerBinId === 'number' &&
            typeof p.upperBinId === 'number' &&
            typeof p.poolActiveBinId === 'number',
        )
        .map((p) => ({
          poolAddress: pool.poolAddress,
          positionAddress: p.positionAddress,
          pairLabel: `${symX}/${symY}`,
          lowerBinId: p.lowerBinId as number,
          upperBinId: p.upperBinId as number,
          activeBinId: p.poolActiveBinId as number,
          inRange: !p.isOutOfRange,
          lowerPrice: Number(p.minPrice),
          upperPrice: Number(p.maxPrice),
        }))
        .filter(
          (w) => w.inRange === (w.activeBinId >= w.lowerBinId && w.activeBinId <= w.upperBinId),
        );
    }),
  );
  return perPool.flat();
}
