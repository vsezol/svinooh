import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PositionTokenDto } from '@svinooh/shared';
import { poolReturns } from '../src/portfolio/pool-returns';

const OPENED = new Date('2026-11-01T00:00:00Z');

const legs = (cbBtc: number, usdc: number, fees: number): PositionTokenDto[] => [
  { symbol: 'cbBTC', valueUsd: cbBtc, role: 'supply' },
  { symbol: 'USDC', valueUsd: usdc, role: 'supply' },
  { symbol: 'USDC', valueUsd: fees, role: 'reward' },
];

test('fees are what accrued since the first reading, measured against the capital put in', () => {
  const returns = poolReturns(
    { createdAt: OPENED, valueUsd: 1001, tokens: legs(500, 500, 1) },
    { valueUsd: 1009.47, tokens: legs(629.61, 370.39, 9.47) },
  );
  assert.deepEqual(returns, { since: OPENED.toISOString(), capitalUsd: 1000, feesUsd: 8.47, pnlUsd: 8.47 });
});

test('a pool that lost more to the price than it earned in fees shows a loss', () => {
  const returns = poolReturns(
    { createdAt: OPENED, valueUsd: 1000, tokens: legs(500, 500, 0) },
    { valueUsd: 980, tokens: legs(0, 975, 5) },
  );
  assert.equal(returns?.feesUsd, 5);
  assert.equal(returns?.pnlUsd, -20);
});

test('fees claimed in between still count what has accrued since the claim', () => {
  const returns = poolReturns(
    { createdAt: OPENED, valueUsd: 1010, tokens: legs(500, 500, 10) },
    { valueUsd: 1002, tokens: legs(500, 500, 2) },
  );
  assert.equal(returns?.feesUsd, 2);
});

test('a first reading with nothing supplied has no capital to measure against', () => {
  assert.equal(
    poolReturns({ createdAt: OPENED, valueUsd: 0, tokens: null }, { valueUsd: 100, tokens: legs(50, 50, 0) }),
    null,
  );
});
