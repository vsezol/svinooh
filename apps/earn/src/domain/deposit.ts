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
 * never read a program log. The two the chain gives most often are the two
 * that stop a real deposit: no token to deposit, and no SOL to open the
 * accounts it needs.
 */
export function whyItWouldFail(logs: readonly string[], token: string): string {
  for (const line of logs) {
    const rent = SHORT_OF_RENT.exec(line);
    if (rent) {
      const has = new Decimal(rent[1]).div(LAMPORTS);
      const needs = new Decimal(rent[2]).div(LAMPORTS);
      return (
        `this deposit opens an account on the protocol and needs ${needs} SOL for its rent, ` +
        `and this wallet has ${has} SOL to spare`
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
