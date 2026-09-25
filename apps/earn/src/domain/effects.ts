import { Decimal } from 'decimal.js';
import type { LiquidityPosition, PairPool } from './liquidity';
import type { Pool } from './pool';

export const NATIVE_SOL = '11111111111111111111111111111111';

export interface CoinAfter {
  mint: string;
  symbol: string;
  amount: Decimal;
  priceUsd: Decimal | null;
}

export interface VaultAfter {
  pool: Pool;
  amount: Decimal;
  priceUsd: Decimal | null;
}

export interface PairAfter {
  pool: PairPool;
  priceX: Decimal;
  priceY: Decimal;
  positions: LiquidityPosition[];
}

export interface Effects {
  slot: number;
  coins: CoinAfter[];
  vaults: VaultAfter[];
  pairs: PairAfter[];
}

export const FRESH_FOR_S = 600;

export const isFresh = (blockTime: number | null, now: Date): boolean =>
  blockTime !== null && now.getTime() / 1000 - blockTime <= FRESH_FOR_S;

export interface TokenBalance {
  mint: string;
  owner: string;
  amount: string;
  decimals: number;
}

export interface Moved {
  mint: string;
  amount: Decimal;
}

const LAMPORTS_PER_SOL = new Decimal(10).pow(9);

export function coinsMoved(
  owner: string,
  before: TokenBalance[],
  after: TokenBalance[],
  lamportsAfter: bigint,
): Moved[] {
  const was = heldBy(owner, before);
  const is = heldBy(owner, after);
  const zero = new Decimal(0);
  const moved = [...new Set([...was.keys(), ...is.keys()])]
    .filter((mint) => !(was.get(mint) ?? zero).equals(is.get(mint) ?? zero))
    .map((mint) => ({ mint, amount: is.get(mint) ?? zero }));
  return [{ mint: NATIVE_SOL, amount: new Decimal(lamportsAfter.toString()).div(LAMPORTS_PER_SOL) }, ...moved];
}

export interface Touched {
  vaults: Pool[];
  unreadable: Pool[];
}

export function poolsTouched(pools: Pool[], accounts: Set<string>): Touched {
  const touched = pools.filter((pool) => accounts.has(pool.deposit.address));
  const readable = (pool: Pool) => pool.id.kind === 'vault' && pool.deposit.sharesMint !== null;
  const vaults = touched.filter(readable);
  const others = touched.filter((pool) => !readable(pool));
  return {
    vaults,
    unreadable: others.filter((pool) => pool.id.kind === 'vault' || vaults.length === 0),
  };
}

export function sharesMints(pools: Pool[]): Set<string> {
  return new Set(pools.flatMap((pool) => (pool.deposit.sharesMint ? [pool.deposit.sharesMint] : [])));
}

function heldBy(owner: string, balances: TokenBalance[]): Map<string, Decimal> {
  const byMint = new Map<string, Decimal>();
  for (const one of balances) {
    if (one.owner !== owner) continue;
    const amount = new Decimal(one.amount).div(new Decimal(10).pow(one.decimals));
    byMint.set(one.mint, (byMint.get(one.mint) ?? new Decimal(0)).plus(amount));
  }
  return byMint;
}
