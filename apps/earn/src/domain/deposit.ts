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

export type LandingStatus = 'pending' | 'landed' | 'failed';

export interface Landing {
  signature: string;
  status: LandingStatus;
  slot: number | null;
  error: string | null;
}
