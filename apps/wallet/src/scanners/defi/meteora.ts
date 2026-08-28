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
}

interface MeteoraPosition {
  positionAddress: string;
  isClosed?: boolean;
  isOutOfRange?: boolean;
  minPrice?: number | string;
  maxPrice?: number | string;
  poolActivePrice?: number | string;
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
