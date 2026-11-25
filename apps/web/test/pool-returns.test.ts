import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { realizedApy } from '../src/lib/pool-returns';

const since = '2026-11-01T00:00:00Z';
const now = Date.parse('2026-11-11T00:00:00Z');

test('fees over ten days are stretched to a year', () => {
  const apy = realizedApy({ since, capitalUsd: 1000, feesUsd: 5, pnlUsd: 0 }, now);
  assert.ok(Math.abs(apy! - (0.005 / 10) * 365) < 1e-12);
});

test('under a day there is too little to stretch to a year', () => {
  assert.equal(realizedApy({ since, capitalUsd: 1000, feesUsd: 5, pnlUsd: 0 }, Date.parse(since) + 3_600_000), null);
});
