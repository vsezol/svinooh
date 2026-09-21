import { Decimal } from 'decimal.js';
import type { Pool } from './pool';

/**
 * What an owner has in a pool: its shares, in the shares mint's own units
 * (the way the vault program counts them), and what they are worth in the
 * pool's token.
 */
export interface Position {
  pool: Pool;
  shares: Decimal;
  amount: Decimal;
}

/** How much to take out: a number of tokens, or everything there is. */
export type Take = Decimal | 'all';

/** A withdrawal once it is known how many shares it burns. */
export interface Withdrawal {
  pool: Pool;
  owner: string;
  shares: Decimal;
  all: boolean;
}

export type Burn = { shares: Decimal; all: boolean } | { short: Decimal; held: Decimal };

const WHISKER = new Decimal('0.001');

/**
 * How many shares taking `take` out of `position` burns.
 *
 * Within a whisker of everything, either side, is everything: the figure the
 * agent was shown is rounded, and a withdrawal that leaves one share behind
 * leaves the accounts open and their rent locked. Past the whisker it is a
 * shortfall, refused with what is there.
 */
export function burnFor(position: Position, take: Take): Burn {
  const everything = { shares: position.shares, all: true };
  if (take === 'all') return everything;
  const held = position.amount;
  if (take.greaterThan(held.mul(new Decimal(1).plus(WHISKER)))) {
    return { short: take.minus(held), held };
  }
  if (take.greaterThanOrEqualTo(held.mul(new Decimal(1).minus(WHISKER)))) return everything;
  const places = position.pool.deposit.sharesDecimals ?? position.pool.token.decimals ?? 0;
  const shares = take.mul(position.shares).div(held).toDecimalPlaces(places, Decimal.ROUND_DOWN);
  return { shares, all: false };
}
