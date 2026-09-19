import { Decimal } from 'decimal.js';
import { EarnError } from '../application/errors';
import {
  DEFAULT_SORT,
  NO_FILTER,
  type PoolFilter,
  type PoolSelection,
  type SortOrder,
} from '../domain/selection';
import { isNetwork, isPoolKind, isProtocol } from '../domain/values';

export class InvalidParameter extends EarnError {}

const SORTS: Record<string, SortOrder> = {
  '-apy': { key: 'apy', descending: true },
  apy: { key: 'apy', descending: false },
  '-tvl_usd': { key: 'tvl_usd', descending: true },
  tvl_usd: { key: 'tvl_usd', descending: false },
  name: { key: 'name', descending: false },
  '-name': { key: 'name', descending: true },
};

type Query = Record<string, string | string[] | undefined>;

const one = (query: Query, name: string): string | null => {
  const raw = query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === '' ? null : value;
};

const decimalAtLeast = (query: Query, name: string, least: number): Decimal | null => {
  const raw = one(query, name);
  if (raw === null) return null;
  let parsed: Decimal;
  try {
    parsed = new Decimal(raw);
  } catch {
    throw new InvalidParameter(`${name}: Input should be a valid decimal`);
  }
  if (!parsed.isFinite() || parsed.lessThan(least)) {
    throw new InvalidParameter(`${name}: Input should be greater than or equal to ${least}`);
  }
  return parsed;
};

export function poolFilter(query: Query): PoolFilter {
  const network = one(query, 'network');
  if (network !== null && !isNetwork(network)) {
    throw new InvalidParameter("network: Input should be 'sol'");
  }
  const protocol = one(query, 'protocol');
  if (protocol !== null && !isProtocol(protocol)) {
    throw new InvalidParameter("protocol: Input should be 'kamino'");
  }
  const kind = one(query, 'kind');
  if (kind !== null && !isPoolKind(kind)) {
    throw new InvalidParameter("kind: Input should be 'vault' or 'reserve'");
  }
  return {
    ...NO_FILTER,
    network,
    protocol,
    token: one(query, 'token'),
    mint: one(query, 'mint'),
    kind,
    minTvl: decimalAtLeast(query, 'min_tvl_usd', 0),
    minApy: decimalAtLeast(query, 'min_apy', 0),
  };
}

export function poolSelection(query: Query): PoolSelection {
  const sort = one(query, 'sort');
  if (sort !== null && !(sort in SORTS)) {
    throw new InvalidParameter(
      "sort: Input should be '-apy', 'apy', '-tvl_usd', 'tvl_usd', 'name' or '-name'",
    );
  }
  return { filter: poolFilter(query), sort: sort === null ? DEFAULT_SORT : SORTS[sort] };
}

export function pageSize(query: Query, defaultSize: number, maxSize: number): number {
  const raw = one(query, 'limit');
  if (raw === null) return Math.min(defaultSize, maxSize);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidParameter('limit: Input should be greater than or equal to 1');
  }
  return Math.min(parsed, maxSize);
}
