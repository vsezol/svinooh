import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PositionTokenDto } from '@svinooh/shared';
import { advance, isStablecoin, realized, type YieldReading, type YieldState } from '../src/wallet/sync/position-yield';

const DAY = 86_400_000;
const START = Date.parse('2026-10-01T00:00:00Z');

const at = (days: number) => new Date(START + days * DAY);

const reading = (
  days: number,
  valueUsd: number,
  tokens: PositionTokenDto[] | null,
  over: Partial<YieldReading> = {},
) => ({
  at: at(days),
  valueUsd,
  amount: null,
  priceUsd: null,
  tokens,
  feesEarnedUsd: null,
  ...over,
});

const leg = (symbol: string, role: PositionTokenDto['role'], amount: number, priceUsd: number): PositionTokenDto => ({
  symbol,
  role,
  amount,
  priceUsd,
  valueUsd: (role === 'borrow' ? -1 : 1) * amount * priceUsd,
});

const replay = (readings: YieldReading[], symbol = 'POS'): YieldState =>
  readings.reduce<YieldState | null>((state, one) => advance(state, one, symbol), null)!;

const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('a pool earns its fees and what the pool did to its tokens, against what went in', () => {
  const pool = (days: number, sol: number, usdc: number, solPrice: number, fees: number) =>
    reading(days, sol * solPrice + usdc + fees, [
      leg('SOL', 'supply', sol, solPrice),
      leg('USDC', 'supply', usdc, 1),
      ...(fees ? [leg('USDC', 'reward', fees, 1)] : []),
    ]);
  const state = replay([
    pool(0, 5, 490, 100, 10),
    pool(5, 5, 490, 100, 30),
    pool(6, 5, 490, 102, 0),
    pool(10, 4.9, 499, 102, 5),
  ]);
  const result = realized(state, at(10))!;
  const base = 5 * 100 + 490;
  close(result.apy, ((-0.1 * 100 + 9 + 25) / base) * 36.5);
  close(result.rewardsApy, (25 / base) * 36.5);
});

test('a loan earns its interest, and a deposit along the way is not income', () => {
  const loan = (days: number, wbtc: number, usdc: number, price: number) =>
    reading(days, wbtc * price - usdc, [leg('WBTC', 'supply', wbtc, price), leg('USDC', 'borrow', usdc, 1)]);
  const state = replay([
    loan(0, 1.0, 20_000, 60_000),
    loan(1, 1.0001, 20_002, 61_000),
    loan(2, 1.5002, 20_004, 62_000),
    loan(10, 1.5005, 20_020, 70_000),
  ]);
  const result = realized(state, at(10))!;
  close(result.apy, (((1.5005 - 1.5001) * 60_000 - (20_020 - 20_002)) / (1.5001 * 60_000 - 20_002)) * 36.5);
  assert.equal(result.rewardsApy, null);
});

test('a principal token on a dollar earns through its price', () => {
  const readings = Array.from({ length: 31 }, (_, day) => {
    const price = 0.97 + (0.005 * day) / 30;
    return reading(day, 1000 * price, [leg('PT-apxUSD-5NOV2026', 'supply', 1000, price)]);
  });
  close(realized(replay(readings), at(30))!.apy, (5 / 970) * (365 / 30));
});

test('GMX rewards are what its own count grew by, and its body is what the GM token grew by', () => {
  const readings = Array.from({ length: 11 }, (_, day) => {
    const value = 1000 + day;
    return reading(day, value, [leg('ETH', 'supply', value / 2500, 2500)], { feesEarnedUsd: 2.84 + day });
  });
  const result = realized(replay(readings), at(10))!;
  close(result.apy, (10 / 1000) * 36.5);
  close(result.rewardsApy, (10 / 1000) * 36.5);
});

test('less than a day of history says nothing yet', () => {
  const state = replay([reading(0, 100, [leg('ETH', 'supply', 0.04, 2500)])]);
  assert.equal(realized(state, at(0.5)), null);
});

test('a leg with no amount cannot be measured in tokens, so there is no yield to state', () => {
  const blind: PositionTokenDto = { symbol: 'GM', role: 'supply', amount: null, priceUsd: null, valueUsd: 100 };
  const state = replay([reading(0, 100, [blind]), reading(3, 101, [{ ...blind, valueUsd: 101 }])]);
  assert.equal(realized(state, at(3))!.apy, null);
});

test('stablecoins are told apart the same way the agent tells them', () => {
  for (const symbol of ['USDC', 'USD₮0', 'USDC.e', 'sUSDe', 'DAI', 'PT-apxUSD-5NOV2026']) {
    assert.ok(isStablecoin(symbol), symbol);
  }
  for (const symbol of ['WETH', 'XAUt', 'GM: ETH/USD [WETH-WETH]', 'PT-wstETH-26DEC2026']) {
    assert.ok(!isStablecoin(symbol), symbol);
  }
});
