import type Decimal from 'decimal.js';
import type { PoolId } from './values';

export interface Token {
  symbol: string;
  mint: string;
  decimals: number | null;
}

export interface Apy {
  base: Decimal;
  rewards: Decimal;
  incentives: Decimal;
}

export interface ApyWindows {
  h24: Decimal | null;
  d7: Decimal | null;
  d30: Decimal | null;
  d90: Decimal | null;
  d365: Decimal | null;
}

export interface Liquidity {
  deposited: Decimal;
  depositedUsd: Decimal;
  available: Decimal | null;
  availableUsd: Decimal | null;
  utilization: Decimal | null;
}

export interface Fees {
  performanceBps: number;
  managementBps: number;
}

export interface Allocation {
  reserve: string;
  market: string;
  marketName: string;
  tokenSymbol: string;
  weightPct: Decimal;
}

export interface DepositTerms {
  programId: string;
  address: string;
  minAmount: Decimal | null;
  sharesMint: string | null;
  sharesDecimals: number | null;
  tokenProgram: string | null;
  lendingMarket: string | null;
  farm: string | null;
}

export interface Pool {
  id: PoolId;
  name: string;
  token: Token;
  apy: Apy;
  tvlUsd: Decimal;
  liquidity: Liquidity;
  deposit: DepositTerms;
  url: string;
  apyWindows: ApyWindows | null;
  fees: Fees | null;
  holders: number | null;
  borrowApy: Decimal | null;
  allocations: Allocation[];
}

export const net = (apy: Apy): Decimal => apy.base.plus(apy.rewards).plus(apy.incentives);
