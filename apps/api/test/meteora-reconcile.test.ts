import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { ScanPosition } from '@svinooh/shared';
import { reconcileMeteora } from '../src/wallet/scanners/sol';
import type { MeteoraPoolPosition } from '../src/wallet/scanners/defi/meteora';

const jupiter = (over: Partial<ScanPosition>): ScanPosition => ({
  symbol: 'Meteora',
  name: 'Liquidity Pool',
  note: 'DLMM',
  valueUsd: 1000,
  platform: 'meteora',
  category: 'defi',
  range: 'in',
  tokens: [
    { symbol: 'SOL', amount: 1, priceUsd: 500, valueUsd: 500, role: 'supply' },
    { symbol: 'USDC', amount: 500, priceUsd: 1, valueUsd: 500, role: 'supply' },
  ],
  ...over,
});

const meteora = (over: Partial<MeteoraPoolPosition>): MeteoraPoolPosition => ({
  poolAddress: 'SOL_USDC_POOL',
  pairLabel: 'SOL/USDC',
  tokenX: 'SOL',
  tokenY: 'USDC',
  valueUsd: 1000,
  feesUsd: 0,
  inRange: true,
  ...over,
});

describe('EachMeteoraPositionIsLabelledByItsOwnPool', () => {
  test('two positions in one pool keep their own ranges, and both learn the pair', () => {
    const labelled = reconcileMeteora(
      [
        jupiter({ ref: 'POSITION_A', pool: 'SOL_USDC_POOL', range: 'in' }),
        jupiter({ ref: 'POSITION_B', pool: 'SOL_USDC_POOL', range: 'out' }),
      ],
      [meteora({ inRange: false, valueUsd: 2000 })],
    );
    assert.deepEqual(
      labelled.map((p) => [p.note, p.range]),
      [
        ['SOL/USDC', 'in'],
        ['SOL/USDC', 'out'],
      ],
    );
  });

  test('a pool is matched by its address, not by whose value is nearer', () => {
    const labelled = reconcileMeteora(
      [
        jupiter({ ref: 'POSITION_A', pool: 'SOL_USDC_POOL', valueUsd: 1000 }),
        jupiter({ ref: 'POSITION_B', pool: 'JUP_SOL_POOL', valueUsd: 990 }),
      ],
      [
        meteora({ poolAddress: 'SOL_USDC_POOL', valueUsd: 990 }),
        meteora({ poolAddress: 'JUP_SOL_POOL', pairLabel: 'JUP/SOL', valueUsd: 1000, inRange: false }),
      ],
    );
    assert.deepEqual(
      labelled.map((p) => [p.ref, p.note, p.range]),
      [
        ['POSITION_A', 'SOL/USDC', 'in'],
        ['POSITION_B', 'JUP/SOL', 'out'],
      ],
    );
  });

  test('a pool Jupiter has not caught up with does not carve up the positions it has', () => {
    const position = jupiter({ ref: 'POSITION_A', pool: 'SOL_USDC_POOL', valueUsd: 1000 });
    const labelled = reconcileMeteora(
      [position],
      [meteora({ valueUsd: 1000 }), meteora({ poolAddress: 'JUP_SOL_POOL', pairLabel: 'JUP/SOL', valueUsd: 400 })],
    );
    assert.equal(labelled.length, 1);
    assert.equal(labelled[0].valueUsd, 1000);
    assert.equal(labelled[0].tokens?.length, 2);
    assert.equal(labelled[0].note, 'SOL/USDC');
  });

  test('positions Jupiter merged into one are still split across their pools', () => {
    const split = reconcileMeteora(
      [jupiter({ valueUsd: 1400 })],
      [meteora({ valueUsd: 1000 }), meteora({ poolAddress: 'JUP_SOL_POOL', pairLabel: 'JUP/SOL', valueUsd: 400 })],
    );
    assert.deepEqual(
      split.map((p) => [p.pool, Math.round(p.valueUsd)]),
      [
        ['SOL_USDC_POOL', 1000],
        ['JUP_SOL_POOL', 400],
      ],
    );
  });
});
