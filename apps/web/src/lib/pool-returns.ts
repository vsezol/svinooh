import type { PositionReturns } from '@svinooh/shared';

const DAY_MS = 86_400_000;

export function daysSince(returns: PositionReturns, now: number): number {
  return (now - Date.parse(returns.since)) / DAY_MS;
}

export function realizedApy(returns: PositionReturns, now: number): number | null {
  const days = daysSince(returns, now);
  if (days <= 0) return null;
  return (returns.feesUsd / returns.capitalUsd) * (365 / days);
}
