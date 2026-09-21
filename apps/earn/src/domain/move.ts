import type { Decimal } from 'decimal.js';
import type { Pool } from './pool';
import { idOf } from './values';

/** A token as a swap needs it: its mint, the places it counts in, and the program that keeps it. */
export interface Coin {
  symbol: string;
  mint: string;
  decimals: number;
  program: string;
}

/** Where money sits or goes: in a pool, or in the wallet as a coin. */
export type Place = { pool: Pool } | { coin: Coin };

/** Where a move's money comes from, and how much of it: shares of a pool, or coins in the wallet. */
export type Source = { pool: Pool; shares: Decimal; all: boolean } | { coin: Coin; amount: Decimal };

/**
 * Money from one place to another — out of a pool or the wallet, into a pool
 * or the wallet — swapped on the way when the two hold different tokens.
 */
export interface Move {
  from: Source;
  to: Place;
  owner: string;
}

export const mintOf = (place: Place): string =>
  'pool' in place ? place.pool.token.mint : place.coin.mint;

export const symbolOf = (place: Place): string =>
  'pool' in place ? place.pool.token.symbol : place.coin.symbol;

export const decimalsOf = (place: Place): number =>
  'pool' in place ? (place.pool.token.decimals ?? 0) : place.coin.decimals;

/** Why a move between these two places cannot be built, or null when it can. */
export function whyNotMove(from: Place, to: Place): string | null {
  if ('pool' in from && 'pool' in to) {
    if (idOf(from.pool.id) === idOf(to.pool.id)) return `the money is already in ${to.pool.name}`;
    if (from.pool.id.network !== to.pool.id.network) {
      return `${from.pool.name} and ${to.pool.name} are on different networks`;
    }
    if (to.pool.id.kind !== 'vault') {
      return `${to.pool.name} is one lending market's reserve; a move goes into a vault`;
    }
    return null;
  }
  if ('coin' in from && 'coin' in to && from.coin.mint === to.coin.mint) {
    return `that is ${to.coin.symbol} already, with nothing to swap`;
  }
  if ('coin' in from && 'pool' in to && from.coin.mint === to.pool.token.mint) {
    return `${to.pool.name} takes ${from.coin.symbol} as it is: that is a deposit, with nothing to swap`;
  }
  return null;
}
