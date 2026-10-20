import { Prisma } from '@prisma/client';
import type { ScanPosition } from '@svinooh/shared';
import { positionKey } from './wallet-state';

export function positionSnapshots(
  chain: string,
  address: string,
  positions: ScanPosition[],
  createdAt: Date,
): Prisma.PositionSnapshotCreateManyInput[] {
  const byKey = new Map<string, ScanPosition>();
  for (const position of positions) {
    if (position.category === 'token') continue;
    const key = positionKey(position);
    const twin = byKey.get(key);
    byKey.set(key, twin ? mergeTwins(twin, position) : position);
  }
  return [...byKey].map(([key, position]) => ({
    chain,
    address,
    key,
    createdAt,
    valueUsd: position.valueUsd,
    amount: position.amount ?? null,
    priceUsd: position.priceUsd ?? null,
    tokens: position.tokens?.length ? (position.tokens as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    band: position.band ? (position.band as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  }));
}

function mergeTwins(first: ScanPosition, second: ScanPosition): ScanPosition {
  return {
    ...first,
    valueUsd: first.valueUsd + second.valueUsd,
    amount: first.amount != null && second.amount != null ? first.amount + second.amount : null,
    tokens: [...(first.tokens ?? []), ...(second.tokens ?? [])],
  };
}
