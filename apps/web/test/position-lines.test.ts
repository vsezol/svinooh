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
  ...over,
});

test('a one-token position is drawn in that token, not in dollars', () => {
  const { lines } = positionLines(
    history({
      usd: [8419, 8300, 8600],
      legs: [{ symbol: 'stETH', role: 'supply', amounts: [3.39, 3.4, 3.41] }],
    }),
    { pool: false, title: 'Fluid Lite' },
  );
  assert.deepEqual(lines, [{ label: 'stETH', unit: 'stETH', role: 'supply', values: [3.39, 3.4, 3.41] }]);
});

test('a loan is a line per leg, and a repaid debt falls to zero', () => {
  const { lines } = positionLines(
    history({
      legs: [
        { symbol: 'ETH', role: 'supply', amounts: [2, 2.001, 2.002] },
        { symbol: 'USDC', role: 'borrow', amounts: [1000, 1001, null] },
      ],
    }),
    { pool: false, title: 'Aave V3' },
  );
  assert.deepEqual(
    lines.map((line) => [line.label, line.values]),
    [
      ['ETH', [2, 2.001, 2.002]],
      ['USDC debt', [1000, 1001, 0]],
    ],
  );
});

test('a pool is the amount of each of its tokens, its fees after them', () => {
  const { lines } = positionLines(
    history({
      legs: [
        { symbol: 'USDC', role: 'supply', amounts: [300, null, null] },
        { symbol: 'WETH', role: 'reward', amounts: [0.01, 0.015, 0.017] },
        { symbol: 'USDC', role: 'reward', amounts: [30, 31, 32.87] },
        { symbol: 'WETH', role: 'supply', amounts: [3.9, 4.04, 4.04] },
      ],
    }),
    { pool: true, title: 'Uniswap V3' },
  );
  assert.deepEqual(
    lines.map((line) => [line.label, line.values]),
    [
      ['USDC', [300, 0, 0]],
      ['WETH', [3.9, 4.04, 4.04]],
      ['WETH fees', [0.01, 0.015, 0.017]],
      ['USDC fees', [30, 31, 32.87]],
    ],
  );
});

test('all lines at once are change from where each one starts', () => {
  assert.deepEqual(asChange([0, 2, 3]), [0, 0, 50]);
  assert.deepEqual(asChange([0, 0]), [0, 0]);
});
