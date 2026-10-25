import type Decimal from 'decimal.js';
import { net, type Pool } from './pool';
import { idOf, type PoolId } from './values';

export interface ListingPolicy {
  minTvl: Decimal;
  excludedNameMarks: string[];
}

export function permits(policy: ListingPolicy, pool: Pool): boolean {
  if (pool.tvlUsd.lessThan(policy.minTvl)) return false;
  if (!net(pool.apy).greaterThan(0)) return false;
  const name = pool.name.toLowerCase();
  return !policy.excludedNameMarks.some((mark) => name.includes(mark));
}

export interface Catalog {
  version: number;
  takenAt: Date;
  listed: Pool[];
  byId: Map<string, Pool>;
  failedSources: string[];
}

export function buildCatalog(input: {
  version: number;
  takenAt: Date;
  pools: Pool[];
  policy: ListingPolicy;
  failedSources?: string[];
}): Catalog {
  return {
    version: input.version,
    takenAt: input.takenAt,
    listed: input.pools.filter((pool) => permits(input.policy, pool)),
    byId: new Map(input.pools.map((pool) => [idOf(pool.id), pool])),
    failedSources: input.failedSources ?? [],
  };
}

export const find = (catalog: Catalog, id: PoolId): Pool | null =>
  catalog.byId.get(idOf(id)) ?? null;

export const ageMs = (catalog: Catalog, now: Date): number =>
  now.getTime() - catalog.takenAt.getTime();

export const isStale = (catalog: Catalog, now: Date, afterMs: number): boolean =>
  ageMs(catalog, now) > afterMs;
