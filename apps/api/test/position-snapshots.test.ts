import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import type { ScanPosition } from '@svinooh/shared';
import { positionSnapshots } from '../src/wallet/sync/position-snapshots';

const AT = new Date('2026-10-12T12:00:00Z');

const fluidLite: ScanPosition = {
  symbol: 'Fluid Lite',
  name: 'Yield',
  network: 'eth',
  pool: '0xa0d3707c569ff8c87fa923d3823ec5d81c98be78',
  valueUsd: 8419.24,
  platform: 'fluid',
  category: 'defi',
  tokens: [{ symbol: 'stETH', amount: 3.39, priceUsd: 2483.84, valueUsd: 8419.24, role: 'supply' }],
};

const eth: ScanPosition = {
  symbol: 'ETH',
  network: 'eth',
  amount: 0.1,
  priceUsd: 2500,
  valueUsd: 250,
  platform: 'wallet',
  category: 'token',
};

test('a wallet holding is not a position and gets no history', () => {
  assert.deepEqual(positionSnapshots('EVM', '0xabc', [eth], AT), []);
});

test('a position keeps its legs in token units', () => {
  const [row] = positionSnapshots('EVM', '0xabc', [fluidLite, eth], AT);
  assert.equal(row.key, 'fluid:eth:Fluid Lite:Yield:pool:0xa0d3707c569ff8c87fa923d3823ec5d81c98be78');
  assert.equal(row.valueUsd, 8419.24);
  assert.equal(row.createdAt, AT);
  assert.deepEqual(row.tokens, fluidLite.tokens);
  assert.equal(row.band, Prisma.DbNull);
});

test('two positions the key cannot tell apart are written as one row', () => {
  const twin = { ...fluidLite, valueUsd: 100, tokens: [{ ...fluidLite.tokens![0], amount: 0.04, valueUsd: 100 }] };
  const rows = positionSnapshots('EVM', '0xabc', [fluidLite, twin], AT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valueUsd, 8519.24);
  assert.equal((rows[0].tokens as unknown[]).length, 2);
});
