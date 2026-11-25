import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { realizedApy } from '../src/lib/pool-returns';

const since = '2026-11-01T00:00:00Z';
const now = Date.parse('2026-11-11T00:00:00Z');

test('fees over ten days are stretched to a year', () => {
  const apy = realizedApy({ since, capitalUsd: 1000, feesUsd: 5, pnlUsd: 0 }, now);
  assert.ok(Math.abs(apy! - (0.005 / 10) * 365) < 1e-12);
});

test('a position read an hour ago is stretched to a year from that hour', () => {
  const apy = realizedApy({ since, capitalUsd: 1000, feesUsd: 0.01, pnlUsd: 0 }, Date.parse(since) + 3_600_000);
  assert.ok(Math.abs(apy! - 0.00001 * 365 * 24) < 1e-12);
});

test('a reading taken this instant has no time to stretch', () => {
  assert.equal(realizedApy({ since, capitalUsd: 1000, feesUsd: 0, pnlUsd: 0 }, Date.parse(since)), null);
});
