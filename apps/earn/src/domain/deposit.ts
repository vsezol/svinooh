import { Decimal } from 'decimal.js';
import type { Pool } from './pool';

export interface Deposit {
  pool: Pool;
  amount: Decimal;
  owner: string;
}

export const hasAccounts = (pool: Pool): boolean =>
  pool.deposit.programId !== '' && pool.deposit.address !== '';

export function belowMinimum(deposit: Deposit): boolean {
  const least = deposit.pool.deposit.minAmount;
  return least !== null && deposit.amount.lessThan(least);
}

export function baseUnits(deposit: Deposit): string {
  const decimals = deposit.pool.token.decimals ?? 0;
  return deposit.amount.mul(new Decimal(10).pow(decimals)).toFixed(0, Decimal.ROUND_DOWN);
}

const WHISKER = new Decimal('0.001');

export type Fit = { amount: Decimal } | { short: Decimal; held: Decimal };

export function fitToHoldings(deposit: Deposit, held: Decimal): Fit {
  const asked = deposit.amount;
  if (held.greaterThanOrEqualTo(asked)) return { amount: asked };
  if (held.greaterThan(0) && held.greaterThanOrEqualTo(asked.mul(new Decimal(1).minus(WHISKER)))) {
    return { amount: held };
  }
  return { short: asked.minus(held), held };
}

const LAMPORTS = new Decimal(10).pow(9);

const SHORT_OF_RENT = /insufficient lamports (\d+), need (\d+)/;

/**
 * Why a simulated deposit did not go through, in words for somebody who has
 * never read a program log. The ones the chain gives most often are the ones
 * that stop a real deposit: no SOL at all, not enough to open the accounts it
 * needs, and not enough of the token itself.
 *
 * A wallet with no SOL is refused before any program runs, so it comes back
 * with an error and no logs at all — which is exactly the case that used to
 * read as "the network refused it", the one person most in need of a reason
 * getting none.
 */
export function whyItWouldFail(err: unknown, logs: readonly string[], token: string): string {
  if (err === 'AccountNotFound') {
    return (
      'this wallet has no SOL at all, and a deposit needs a little: for the network fee, and ' +
      'as a returnable deposit for the accounts it opens'
    );
  }
  if (err === 'InsufficientFundsForFee') {
    return 'this wallet does not have enough SOL to pay the network fee';
  }
  if (typeof err === 'object' && err !== null && 'InsufficientFundsForRent' in err) {
    return 'this wallet does not have enough SOL for the returnable deposit on the accounts this opens';
  }
  for (const line of logs) {
    const rent = SHORT_OF_RENT.exec(line);
    if (rent) {
      const has = new Decimal(rent[1]).div(LAMPORTS);
      const needs = new Decimal(rent[2]).div(LAMPORTS);
      return (
        `this deposit opens an account on the protocol and needs ${needs} SOL for it — ` +
        `a returnable deposit, not a fee — and this wallet has ${has} SOL to spare`
      );
    }
    if (line.includes('Error: insufficient funds')) {
      return `this wallet does not hold enough ${token} for this deposit`;
    }
  }
  const failed = logs.filter((line) => line.includes('failed:')).pop();
  return failed ? `the network refused it: ${failed}` : 'the network refused it';
}

export type LandingStatus = 'pending' | 'landed' | 'failed';

export interface Landing {
  signature: string;
  status: LandingStatus;
  slot: number | null;
  error: string | null;
}
