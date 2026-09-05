import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { repriceElements } from '../src/scanners/jup';

/** The live shape, reduced to what the reprice pass reads */
const leg = (address: string, price: number, amount: number, fixed = false) => ({
  value: amount * price,
  data: {
    address,
    price,
    amount: fixed
      ? { fixed: true, raw: String(Math.round(amount * 1e8)), decimals: 8 }
      : { fixed: false, value: amount, decimals: 9 },
  },
});

const CBBTC = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';
const SOL = 'So11111111111111111111111111111111111111112';
const STALE = 81776.69;
const LIVE = 79624.11;

const prices: Record<string, number> = { [CBBTC]: LIVE, [SOL]: 102.4 };
const priceOf = (mint: string) => prices[mint];

describe('repriceElements — Jupiter against Jupiter', () => {
  /**
   * The sawtooth as it was caught in the wild: one portfolio replica pricing
   * cbBTC 2.7% above every other feed, same amounts, every other leg agreeing.
   */
  test('a stale supplied leg is repriced and the element value moves with it', () => {
    const kamino = {
      platformId: 'kamino',
      value: 4110.01 + 0.1090025893328798 * STALE,
      data: {
        suppliedAssets: [leg(SOL, 102.33, 40.1613), leg(CBBTC, STALE, 0.1090025893328798)],
      },
    };
    const notes = repriceElements([kamino], priceOf);

    assert.equal(notes.length, 1);
    assert.match(notes[0], /cbbtcf in kamino/);
    const fixed = kamino.data.suppliedAssets[1];
    assert.equal(fixed.data.price, LIVE);
    // the element lost exactly what the stale price had inflated it by
    assert.ok(Math.abs(kamino.value - (4110.01 + 0.1090025893328798 * LIVE)) < 0.01);
  });

  test('a fixed/raw amount reprices through the same arithmetic', () => {
    const meteora = {
      platformId: 'meteora',
      value: 0.02887646 * STALE,
      data: { assets: [leg(CBBTC, STALE, 0.02887646, true)] },
    };
    repriceElements([meteora], priceOf);
    assert.ok(Math.abs(meteora.value - 0.02887646 * LIVE) < 0.01);
  });

  /**
   * A borrow priced too high is a debt bigger than it is. Correcting it makes
   * the position WORTH MORE — the sign flips relative to every other bucket.
   */
  test('a stale borrow leg moves the element value the other way', () => {
    const lend = {
      platformId: 'kamino',
      value: 10_000 - 0.05 * STALE,
      data: { borrowedAssets: [leg(CBBTC, STALE, 0.05)] },
    };
    repriceElements([lend], priceOf);
    assert.ok(Math.abs(lend.value - (10_000 - 0.05 * LIVE)) < 0.01);
  });

  test('ordinary dispersion between two live feeds is left alone', () => {
    const el = { value: 4110.01, data: { suppliedAssets: [leg(SOL, 102.33, 40.1613)] } };
    assert.equal(repriceElements([el], priceOf).length, 0);
    assert.equal(el.data.suppliedAssets[0].data.price, 102.33);
  });

  test('a dust leg is not rewritten over fractions of a cent', () => {
    const el = { value: 0.11, data: { suppliedAssets: [leg(CBBTC, STALE, 0.0000014)] } };
    assert.equal(repriceElements([el], priceOf).length, 0);
  });

  test('a mint the asset search has no price for is not touched', () => {
    const el = { value: 500, data: { suppliedAssets: [leg('UnknownMint1111', 500, 1)] } };
    assert.equal(repriceElements([el], priceOf).length, 0);
  });

  test('the same stale mint is corrected in every element it appears in', () => {
    const a = { platformId: 'kamino', value: 0.1 * STALE, data: { suppliedAssets: [leg(CBBTC, STALE, 0.1)] } };
    const b = { platformId: 'meteora', value: 0.03 * STALE, data: { assets: [leg(CBBTC, STALE, 0.03)] } };
    const notes = repriceElements([a, b], priceOf);
    assert.equal(notes.length, 2);
    assert.ok(Math.abs(a.value - 0.1 * LIVE) < 0.01);
    assert.ok(Math.abs(b.value - 0.03 * LIVE) < 0.01);
  });
});
