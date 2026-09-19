import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { DefiFacts, ScanPosition, ScanPositionToken, SupplyFact } from '@svinooh/shared';
import { enrich, needsLendingFacts, rateFromAggregator } from '../src/defi-facts';

const leg = (symbol: string, role: ScanPositionToken['role'], valueUsd: number): ScanPositionToken =>
  ({ symbol, amount: 1, priceUsd: valueUsd, valueUsd, role }) as ScanPositionToken;

const lending = (over: Partial<ScanPosition>): ScanPosition =>
  ({
    symbol: 'Kamino',
    name: 'Lending',
    note: 'Main Market',
    platform: 'kamino',
    valueUsd: 15_000,
    tokens: [],
    ...over,
  }) as ScanPosition;

const supply = (over: Partial<SupplyFact> = {}): SupplyFact => ({
  id: 'kamino:Main Market:supply',
  platform: 'kamino',
  market: 'Main Market',
  rates: { CBBTC: 0.004, SOL: 4.52 },
  ...over,
});

const facts = (over: Partial<DefiFacts> = {}): DefiFacts => ({
  pools: [],
  lending: [],
  supply: [],
  failed: [],
  ...over,
});

describe('WhoseRateIsOnAPosition', () => {
  test('a pool earns one rate for the whole thing, and keeps it', () => {
    const rate = rateFromAggregator({
      label: 'LiquidityPool',
      netApy: 0.21,
      borrowed: 0,
      supplied: 2,
    });
    assert.equal(rate, 0.21);
  });

  test('two assets lent at two rates have no single rate between them', () => {
    const rate = rateFromAggregator({ label: 'Lending', netApy: 0.0093, borrowed: 0, supplied: 2 });
    assert.equal(rate, null);
  });

  test('one asset lent is its own rate', () => {
    const rate = rateFromAggregator({ label: 'Lending', netApy: 0.0512, borrowed: 0, supplied: 1 });
    assert.equal(rate, 0.0512);
  });

  test('anything borrowed makes the net rate a number about two things', () => {
    const rate = rateFromAggregator({ label: 'Lending', netApy: 0.0093, borrowed: 1, supplied: 2 });
    assert.equal(rate, null);
  });

  test('a rate nobody reported is not a rate of zero', () => {
    assert.equal(rateFromAggregator({ label: 'Lending', netApy: 0, borrowed: 0, supplied: 1 }), null);
    assert.equal(rateFromAggregator({ label: 'Lending', netApy: null, borrowed: 0, supplied: 1 }), null);
  });
});

describe('AskingTheProtocolWhatItPays', () => {
  test('money lent on a protocol we can ask is worth asking about', () => {
    const supplying = lending({ tokens: [leg('SOL', 'supply', 4490)] });
    assert.equal(needsLendingFacts([supplying]), true);
  });

  test('a pool is not a loan and is not asked about', () => {
    const pool = lending({
      symbol: 'Meteora',
      platform: 'meteora',
      name: 'Liquidity Pool',
      tokens: [leg('SOL', 'supply', 100), leg('USDC', 'supply', 100)],
    });
    assert.equal(needsLendingFacts([pool]), false);
  });

  test('a protocol with no source of its own is not asked either', () => {
    const elsewhere = lending({ symbol: 'Drift', platform: 'drift', tokens: [leg('SOL', 'supply', 1)] });
    assert.equal(needsLendingFacts([elsewhere]), false);
  });
});

describe('WhatEachSuppliedAssetEarns', () => {
  test('every supplied leg takes the rate its own reserve pays', () => {
    const position = lending({
      tokens: [leg('cbBTC', 'supply', 10_743), leg('SOL', 'supply', 4490)],
    });
    const [enriched] = enrich([position], facts({ supply: [supply()] }));
    const rates = (enriched.tokens ?? []).map((t) => t.apy);
    assert.deepEqual(rates, [0.00004, 0.0452]);
  });

  test('two rates on two assets are still not one rate for the position', () => {
    const position = lending({
      apy: 0.0093,
      tokens: [leg('cbBTC', 'supply', 10_743), leg('SOL', 'supply', 4490)],
    });
    const [enriched] = enrich([position], facts({ supply: [supply()] }));
    assert.equal(enriched.apy, 0.0093, 'the position keeps whatever it came with');
  });

  test('one asset lent takes the protocol’s own rate, not the aggregator’s', () => {
    const position = lending({ apy: 0.0093, tokens: [leg('SOL', 'supply', 4490)] });
    const [enriched] = enrich([position], facts({ supply: [supply()] }));
    assert.equal(enriched.apy, 0.0452);
  });

  test('the market on the position is the market the rates come from', () => {
    const position = lending({ note: 'SOL/BTC Market', tokens: [leg('SOL', 'supply', 4490)] });
    const [enriched] = enrich(
      [position],
      facts({
        supply: [supply(), supply({ market: 'SOL/BTC Market', rates: { SOL: 6.1 } })],
      }),
    );
    assert.equal(enriched.apy, 0.061);
  });

  test('two markets and no way to tell which is this one leaves the position alone', () => {
    const position = lending({ note: null, apy: 0.0093, tokens: [leg('SOL', 'supply', 4490)] });
    const [enriched] = enrich(
      [position],
      facts({ supply: [supply(), supply({ market: 'SOL/BTC Market', rates: { SOL: 6.1 } })] }),
    );
    assert.equal(enriched.apy, 0.0093);
    assert.equal((enriched.tokens ?? [])[0].apy, undefined);
  });

  test('a borrowing position is left to the loan facts, not these', () => {
    const position = lending({
      tokens: [leg('cbBTC', 'supply', 10_743), leg('USDT', 'borrow', -4202)],
    });
    const [enriched] = enrich([position], facts({ supply: [supply()] }));
    assert.equal((enriched.tokens ?? [])[0].apy, undefined);
  });

  test('another protocol’s rates are never put on this one', () => {
    const position = lending({ tokens: [leg('SOL', 'supply', 4490)] });
    const [enriched] = enrich(
      [position],
      facts({ supply: [supply({ platform: 'aave', market: 'Main Market' })] }),
    );
    assert.equal((enriched.tokens ?? [])[0].apy, undefined);
  });
});
