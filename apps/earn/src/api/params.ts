import { Decimal } from 'decimal.js';
import { EarnError } from '../application/errors';
import type { Named } from '../application/moves';
import {
  DEFAULT_SORT,
  NO_FILTER,
  type PoolFilter,
  type PoolSelection,
  type SortOrder,
} from '../domain/selection';
import { isNetwork, isPoolKind, isProtocol, type Network } from '../domain/values';

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

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface DepositBody {
  amount: Decimal;
  owner: string;
}

export function depositBody(body: unknown): DepositBody {
  const given = (body ?? {}) as Record<string, unknown>;
  const amount = given.amount;
  if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) {
    throw new InvalidParameter('amount: Input should be a number of tokens');
  }
  const parsed = new Decimal(amount);
  if (!parsed.isFinite() || parsed.lessThanOrEqualTo(0)) {
    throw new InvalidParameter('amount: Input should be greater than 0');
  }
  const owner = given.owner;
  if (typeof owner !== 'string' || !BASE58.test(owner)) {
    throw new InvalidParameter('owner: Input should be a base58 account address');
  }
  return { amount: parsed, owner };
}

export interface TakeBody {
  take: Decimal | 'all';
  owner: string;
}

/** A withdrawal's or a move's body: how much ("all", or a number of tokens) and whose. */
export function takeBody(body: unknown): TakeBody {
  const given = (body ?? {}) as Record<string, unknown>;
  const owner = given.owner;
  if (typeof owner !== 'string' || !BASE58.test(owner)) {
    throw new InvalidParameter('owner: Input should be a base58 account address');
  }
  if (given.amount === 'all') return { take: 'all', owner };
  return { take: depositBody({ amount: given.amount, owner }).amount, owner };
}

const COIN = /^([1-9A-HJ-NP-Za-km-z]{32,44}|[\w$.\-]{1,20})$/;

export interface MoveBody extends TakeBody {
  from: Named;
  to: Named;
}

/**
 * A move's body: each end a pool by its id (`from`, `to`) or a coin in the
 * wallet by its mint or ticker (`from_coin`, `to_coin`), and how much, and whose.
 */
export function moveBody(body: unknown): MoveBody {
  const given = (body ?? {}) as Record<string, unknown>;
  return { from: endOf(given, 'from'), to: endOf(given, 'to'), ...takeBody(body) };
}

function endOf(given: Record<string, unknown>, side: 'from' | 'to'): Named {
  const pool = given[side];
  if (typeof pool === 'string' && pool) return { pool };
  const coin = given[`${side}_coin`];
  if (typeof coin === 'string' && COIN.test(coin)) return { coin };
  throw new InvalidParameter(
    `${side}: Input should be a pool id, or ${side}_coin a coin's mint or ticker`,
  );
}

export function coinOf(query: Query): string {
  const asked = one(query, 'q');
  if (asked === null || !COIN.test(asked)) {
    throw new InvalidParameter("q: Input should be a coin's mint or ticker");
  }
  return asked;
}

/** The wallets to look in first, when there are any: `owner`, once or more. */
export function ownersOf(query: Query): string[] {
  const raw = query.owner;
  const owners = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  if (owners.length > 10 || owners.some((owner) => !BASE58.test(owner))) {
    throw new InvalidParameter('owner: Input should be up to ten base58 account addresses');
  }
  return owners;
}

export function ownerOf(query: Query): string {
  const owner = one(query, 'owner');
  if (owner === null || !BASE58.test(owner)) {
    throw new InvalidParameter('owner: Input should be a base58 account address');
  }
  return owner;
}

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export function signatureOf(raw: string): string {
  if (!SIGNATURE.test(raw)) {
    throw new InvalidParameter('signature: Input should be a base58 transaction signature');
  }
  return raw;
}

export function networkOf(query: Query): Network {
  const network = one(query, 'network');
  if (network === null || !isNetwork(network)) {
    throw new InvalidParameter("network: Input should be 'sol'");
  }
  return network;
}

/**
 * The pair a query asks about: `pair=SOL-USDC` (or `SOL/USDC`), each side a
 * ticker or a mint.
 */
export function pairOf(query: Query): [string, string] {
  const raw = one(query, 'pair');
  const sides = raw ? raw.split(/[-/]/).map((side) => side.trim()) : [];
  if (sides.length !== 2 || sides.some((side) => !COIN.test(side))) {
    throw new InvalidParameter('pair: Input should be two tickers or mints, as SOL-USDC');
  }
  return [sides[0], sides[1]];
}

/**
 * A range around the current price, in percent each way — `below_pct=10.3&
 * above_pct=5.5` is from 10.3% under the price to 5.5% over it — or null when
 * neither is given.
 */
export function rangeOf(query: Query): { below: Decimal; above: Decimal } | null {
  const below = decimalAtLeast(query, 'below_pct', 0);
  const above = decimalAtLeast(query, 'above_pct', 0);
  if (below === null && above === null) return null;
  if (below === null || above === null) {
    throw new InvalidParameter('below_pct and above_pct: Input should be given together');
  }
  if (below.gte(100)) throw new InvalidParameter('below_pct: Input should be less than 100');
  return { below: below.div(100), above: above.div(100) };
}

/** How far either way of the price counts as near it, when asked: `active_pct=1` is 1%. */
export function activeShareOf(query: Query): Decimal | null {
  const share = decimalAtLeast(query, 'active_pct', 0);
  if (share === null || share.isZero()) return null;
  if (share.gte(100)) throw new InvalidParameter('active_pct: Input should be less than 100');
  return share.div(100);
}

export interface ProvideBody {
  owner: string;
  spend:
    | { coin: string; amount: Decimal | 'all' }
    | { amountX: Decimal; amountY: Decimal }
    | { from: string; amount: Decimal | 'all' };
  range: { below: Decimal; above: Decimal };
}

const tokensIn = (given: Record<string, unknown>, name: string): Decimal => {
  const raw = given[name];
  if (raw === undefined || raw === null || raw === '') return new Decimal(0);
  if (typeof raw !== 'string' || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new InvalidParameter(`${name}: Input should be a number of tokens`);
  }
  return new Decimal(raw);
};

/**
 * What goes into a pair pool: `amount` of `coin` (one of the pool's two
 * tokens, or "all" of it), or `amount_x` and `amount_y` of each; and the
 * range, `below_pct` and `above_pct` from the price.
 */
export function provideBody(body: unknown): ProvideBody {
  const given = (body ?? {}) as Record<string, unknown>;
  const range = rangeOf(given as Query);
  if (!range) throw new InvalidParameter('below_pct and above_pct: Input should be given');
  const owner = ownerIn(given);
  if (typeof given.from === 'string' && given.from) {
    return { owner, range, spend: { from: given.from, amount: takeBody(given).take } };
  }
  if (given.amount_x !== undefined || given.amount_y !== undefined) {
    return { owner, range, spend: { amountX: tokensIn(given, 'amount_x'), amountY: tokensIn(given, 'amount_y') } };
  }
  const coin = given.coin;
  if (typeof coin !== 'string' || !COIN.test(coin)) {
    throw new InvalidParameter("coin: Input should be one of the pool's two tokens, by ticker or mint");
  }
  const { take } = takeBody(given);
  return { owner, range, spend: { coin, amount: take } };
}

export interface PositionBody {
  owner: string;
  range: { below: Decimal; above: Decimal } | null;
  carried: { amountX: Decimal; amountY: Decimal } | null;
}

/** A close's or a rebalance's body: whose, and for a rebalance the new range and what an earlier step carried. */
export function positionBody(body: unknown): PositionBody {
  const given = (body ?? {}) as Record<string, unknown>;
  const carried =
    given.amount_x !== undefined || given.amount_y !== undefined
      ? { amountX: tokensIn(given, 'amount_x'), amountY: tokensIn(given, 'amount_y') }
      : null;
  return { owner: ownerIn(given), range: rangeOf(given as Query), carried };
}

function ownerIn(given: Record<string, unknown>): string {
  const owner = given.owner;
  if (typeof owner !== 'string' || !BASE58.test(owner)) {
    throw new InvalidParameter('owner: Input should be a base58 account address');
  }
  return owner;
}

export function addressOf(raw: string, name: string): string {
  if (!BASE58.test(raw)) throw new InvalidParameter(`${name}: Input should be a base58 account address`);
  return raw;
}
