import type { PositionReturns, PositionTokenDto } from '@svinooh/shared';
import { round2 } from '../common/util';

export interface PoolReading {
  createdAt: Date;
  valueUsd: number;
  tokens: PositionTokenDto[] | null;
}

export function poolReturns(first: PoolReading, current: Omit<PoolReading, 'createdAt'>): PositionReturns | null {
  const capitalUsd = sumByRole(first.tokens, 'supply');
  if (capitalUsd <= 0) return null;
  const feesAtStart = sumByRole(first.tokens, 'reward');
  const feesNow = sumByRole(current.tokens, 'reward');
  return {
    since: first.createdAt.toISOString(),
    capitalUsd: round2(capitalUsd),
    feesUsd: round2(feesNow >= feesAtStart ? feesNow - feesAtStart : feesNow),
    pnlUsd: round2(current.valueUsd - first.valueUsd),
  };
}

function sumByRole(tokens: PositionTokenDto[] | null, role: PositionTokenDto['role']): number {
  return (tokens ?? []).filter((token) => token.role === role).reduce((sum, token) => sum + Math.abs(token.valueUsd), 0);
}
