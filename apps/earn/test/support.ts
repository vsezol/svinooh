import { Decimal } from 'decimal.js';
import type { Pool } from '../src/domain/pool';
import type { PoolKind } from '../src/domain/values';

export const pool = (over: Partial<Pool> & { address?: string } = {}): Pool => {
  const address = over.address ?? 'AAA';
  const kind: PoolKind = over.id?.kind ?? 'vault';
  return {
    id: { network: 'sol', protocol: 'kamino', kind, address },
    name: 'Steakhouse USDC',
    token: { symbol: 'USDC', mint: 'EPjF', decimals: 6 },
    apy: { base: new Decimal('0.05'), rewards: new Decimal(0), incentives: new Decimal(0) },
    tvlUsd: new Decimal('42000000'),
    liquidity: {
      deposited: new Decimal('42000000'),
      depositedUsd: new Decimal('42000000'),
      available: new Decimal('1000'),
      availableUsd: new Decimal('1000'),
      utilization: null,
    },
    deposit: {
      programId: 'KvauG',
      address,
      minAmount: null,
      sharesMint: null,
      sharesDecimals: null,
      tokenProgram: null,
      lendingMarket: null,
      farm: null,
    },
    url: `https://kamino.com/earn/lend/${address}`,
    apyWindows: null,
    fees: null,
    holders: null,
    borrowApy: null,
    allocations: [],
    ...over,
  };
};

export const policy = {
  minTvl: new Decimal('100000'),
  excludedNameMarks: ['test', 'staging', 'mock', 'demo'],
};
