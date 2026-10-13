import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PositionBand } from '@svinooh/shared';
import { positionSeries, type PositionReading } from '../src/portfolio/position-history';

const BAND: PositionBand = {
  pair: 'SOL/USDC',
  feePct: 0.01,
  chainLabel: 'Solana',
  lower: 110,
  upper: 130,
  current: 125,
  priceLabel: 'USDC per SOL',
};

const reading = (t: number, over: Partial<PositionReading>): PositionReading => ({
  t,
  usd: 0,
  amount: null,
  tokens: null,
  band: null,
  ...over,
});

test('each leg becomes one row of amounts, a debt counted as what is owed', () => {
  const series = positionSeries([
    reading(0, {
      usd: 5000,
      tokens: [
        { symbol: 'ETH', amount: 3, priceUsd: 2500, valueUsd: 7500, role: 'supply' },
        { symbol: 'USDC', amount: -2500, priceUsd: 1, valueUsd: -2500, role: 'borrow' },
      ],
    }),
    reading(60_000, {
      usd: 5100,
      tokens: [{ symbol: 'ETH', amount: 3.01, priceUsd: 2540, valueUsd: 7645.4, role: 'supply' }],
    }),
  ]);
  assert.deepEqual(series.legs, [
    { symbol: 'ETH', role: 'supply', amounts: [3, 3.01] },
    { symbol: 'USDC', role: 'borrow', amounts: [2500, null] },
  ]);
  assert.deepEqual(series.prices, { ETH: [2500, 2540], USDC: [1, null] });
  assert.deepEqual(series.usd, [5000, 5100]);
});

test('twins in one reading add up into one leg', () => {
  const leg = { symbol: 'stETH', amount: 1, priceUsd: 2500, valueUsd: 2500, role: 'supply' as const };
  const series = positionSeries([reading(0, { tokens: [leg, { ...leg, amount: 0.5 }] })]);
  assert.deepEqual(series.legs[0].amounts, [1.5]);
});

test('an LP that left its range still prices the token it no longer holds', () => {
  const series = positionSeries([
    reading(0, {
      band: BAND,
      tokens: [{ symbol: 'USDC', amount: 1000, priceUsd: 1, valueUsd: 1000, role: 'supply' }],
    }),
    reading(60_000, {
      band: { ...BAND, current: 105 },
      tokens: [{ symbol: 'SOL', amount: 9, priceUsd: 105, valueUsd: 945, role: 'supply' }],
    }),
  ]);
  assert.deepEqual(series.prices.SOL, [125, 105]);
  assert.deepEqual(series.prices.USDC, [1, 1]);
});
