import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { net, type Pool } from './pool';
import { idOf, type Network, type PoolKind, type Protocol } from './values';

export type SortKey = 'apy' | 'tvl_usd' | 'name';

export interface SortOrder {
  key: SortKey;
  descending: boolean;
}

export const DEFAULT_SORT: SortOrder = { key: 'apy', descending: true };

export const sortAsWritten = (sort: SortOrder): string =>
  `${sort.descending ? '-' : ''}${sort.key}`;

export interface PoolFilter {
  network: Network | null;
  protocol: Protocol | null;
  token: string | null;
  mint: string | null;
  kind: PoolKind | null;
  minTvl: Decimal | null;
  minApy: Decimal | null;
}

export const NO_FILTER: PoolFilter = {
  network: null,
  protocol: null,
  token: null,
  mint: null,
  kind: null,
  minTvl: null,
  minApy: null,
};

export function matches(filter: PoolFilter, pool: Pool): boolean {
  if (filter.network !== null && pool.id.network !== filter.network) return false;
  if (filter.protocol !== null && pool.id.protocol !== filter.protocol) return false;
  if (filter.kind !== null && pool.id.kind !== filter.kind) return false;
  if (filter.mint !== null && pool.token.mint !== filter.mint) return false;
  if (filter.token !== null && pool.token.symbol.toUpperCase() !== filter.token.toUpperCase()) {
    return false;
  }
  if (filter.minTvl !== null && pool.tvlUsd.lessThan(filter.minTvl)) return false;
  return !(filter.minApy !== null && net(pool.apy).lessThan(filter.minApy));
}

export interface PoolSelection {
  filter: PoolFilter;
  sort: SortOrder;
}

const compare = (left: Pool, right: Pool, key: SortKey): number => {
  if (key === 'name') {
    const a = left.name.toLowerCase();
    const b = right.name.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = key === 'apy' ? net(left.apy) : left.tvlUsd;
  const b = key === 'apy' ? net(right.apy) : right.tvlUsd;
  return a.comparedTo(b);
};

export function apply(selection: PoolSelection, pools: Pool[]): Pool[] {
  const chosen = pools.filter((pool) => matches(selection.filter, pool));
  const ordered = [...chosen].sort((left, right) => {
    const byKey = compare(left, right, selection.sort.key);
    if (byKey !== 0) return byKey;
    const a = idOf(left.id);
    const b = idOf(right.id);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return selection.sort.descending ? ordered.reverse() : ordered;
}

const plain = (value: Decimal | null): string | null => (value === null ? null : value.toString());

export function fingerprint(selection: PoolSelection): string {
  const shape = {
    kind: selection.filter.kind,
    min_apy: plain(selection.filter.minApy),
    min_tvl: plain(selection.filter.minTvl),
    mint: selection.filter.mint,
    network: selection.filter.network,
    protocol: selection.filter.protocol,
    sort: sortAsWritten(selection.sort),
    token: (selection.filter.token ?? '').toUpperCase() || null,
  };
  const written = `{${Object.entries(shape)
    .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
    .join(', ')}}`;
  return createHash('sha256').update(written).digest('hex').slice(0, 12);
}

export interface Page {
  items: Pool[];
  total: number;
  nextOffset: number | null;
}

export function paginate(pools: Pool[], offset: number, limit: number): Page {
  const window = pools.slice(offset, offset + limit);
  const consumed = offset + window.length;
  return {
    items: window,
    total: pools.length,
    nextOffset: consumed < pools.length ? consumed : null,
  };
}
