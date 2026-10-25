import { Decimal } from 'decimal.js';
import { net, type Pool } from './pool';

export interface TokenYield {
  tokenSymbol: string;
  mint: string;
  decimals: number | null;
  poolCount: number;
  totalTvl: Decimal;
  best: Pool;
}

const richest = (pools: Pool[]): Pool =>
  pools.reduce((best, pool) => (net(pool.apy).greaterThan(net(best.apy)) ? pool : best));

export function tokenYields(pools: Pool[]): TokenYield[] {
  const grouped = new Map<string, Pool[]>();
  for (const pool of pools) {
    const key = `${pool.id.network}:${pool.token.mint}`;
    const group = grouped.get(key);
    if (group) group.push(pool);
    else grouped.set(key, [pool]);
  }

  const rows = [...grouped.values()].map((group) => {
    const best = richest(group);
    return {
      tokenSymbol: best.token.symbol,
      mint: group[0].token.mint,
      decimals: group.find((pool) => pool.token.decimals)?.token.decimals ?? null,
      poolCount: group.length,
      totalTvl: group.reduce((sum, pool) => sum.plus(pool.tvlUsd), new Decimal(0)),
      best,
    };
  });
  return rows.sort((left, right) => right.totalTvl.comparedTo(left.totalTvl));
}
