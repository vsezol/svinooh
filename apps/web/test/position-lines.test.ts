import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PositionHistoryDto } from '@svinooh/shared';
import { asChange, positionLines } from '../src/lib/position-lines';

const history = (over: Partial<PositionHistoryDto>): PositionHistoryDto => ({
  range: '7d',
  times: ['2026-10-12T00:00:00Z', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z'],
  usd: [0, 0, 0],
  amounts: [null, null, null],
  legs: [],
  prices: {},
  ...over,
});

test('a one-token position is drawn in that token, not in dollars', () => {
  const { lines } = positionLines(
    history({
      usd: [8419, 8300, 8600],
      legs: [{ symbol: 'stETH', role: 'supply', amounts: [3.39, 3.4, 3.41] }],
      prices: { stETH: [2483, 2441, 2522] },
    }),
    { pair: null, title: 'Fluid Lite' },
  );
  assert.deepEqual(lines, [{ label: 'stETH', unit: 'stETH', owed: false, values: [3.39, 3.4, 3.41] }]);
});

test('a loan is a line per leg, and a repaid debt falls to zero', () => {
  const { lines } = positionLines(
    history({
      legs: [
        { symbol: 'ETH', role: 'supply', amounts: [2, 2.001, 2.002] },
        { symbol: 'USDC', role: 'borrow', amounts: [1000, 1001, null] },
      ],
    }),
    { pair: null, title: 'Aave V3' },
  );
  assert.deepEqual(
    lines.map((line) => [line.label, line.values]),
    [
      ['ETH', [2, 2.001, 2.002]],
      ['USDC debt', [1000, 1001, 0]],
    ],
  );
});

test('a pool is worth so much of each token, and collecting fees does not make it fall', () => {
  const { lines } = positionLines(
    history({
      usd: [0, 0, 0],
      legs: [
        { symbol: 'SOL', role: 'supply', amounts: [10, 10, 10] },
        { symbol: 'USDC', role: 'supply', amounts: [1000, 1000, 1000] },
        { symbol: 'USDC', role: 'reward', amounts: [0, 100, null] },
      ],
      prices: { SOL: [100, 100, 100], USDC: [1, 1, 1] },
    }),
    { pair: 'SOL/USDC', title: 'Meteora' },
  );
  assert.deepEqual(
    lines.map((line) => [line.label, line.values]),
    [
      ['in SOL', [20, 21, 21]],
      ['in USDC', [2000, 2100, 2100]],
    ],
  );
});

test('a pool without prices for its pair falls back to its legs', () => {
  const { lines } = positionLines(
    history({ legs: [{ symbol: 'GM', role: 'supply', amounts: [5, 5, 6] }] }),
    { pair: 'ETH/USDC', title: 'GMX' },
  );
  assert.deepEqual(lines.map((line) => line.label), ['GM']);
});

test('all lines at once are change from where each one starts', () => {
  assert.deepEqual(asChange([0, 2, 3]), [0, 0, 50]);
  assert.deepEqual(asChange([0, 0]), [0, 0]);
});
