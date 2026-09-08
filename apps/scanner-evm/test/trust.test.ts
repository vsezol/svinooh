import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { ScanPosition } from '@svinooh/shared';
import { answeredForSomebodyElse, unexplainedTotal } from '../src/scanners/trust';

const MINE = '0x7f5e1bb2c76a0bb0ef074dba54d96ed2fa7bba6a';
const THEIRS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

const pos = (valueUsd: number): ScanPosition =>
  ({ symbol: 'X', valueUsd, platform: 'wallet', category: 'token' }) as ScanPosition;

describe('whose data is this', () => {
  test('payloads fetched for our own address pass', () => {
    assert.equal(answeredForSomebodyElse(MINE, MINE), false);
  });

  test('payloads fetched for another address are refused', () => {
    assert.equal(answeredForSomebodyElse(THEIRS, MINE), true);
  });

  test('case is not identity — DeBank checksums its addresses', () => {
    assert.equal(answeredForSomebodyElse(MINE.toUpperCase(), MINE), false);
  });

  test('nothing captured is not a mismatch — it has its own answer upstream', () => {
    assert.equal(answeredForSomebodyElse(null, MINE), false);
  });
});

describe('does the total add up', () => {
  test('a header its positions account for passes', () => {
    assert.equal(unexplainedTotal(27_431, [pos(20_000), pos(7_431)]), false);
  });

  test('the incident: a $17 wallet handed a $1,166,714 header', () => {
    assert.equal(unexplainedTotal(1_166_714, [pos(10), pos(7)]), true);
  });

  test('DeBank keeping dust in its sum is not a mismatch', () => {
    // The list drops sub-cent items, so the sum runs a little under. Loose on
    // purpose: this is not an audit of their arithmetic.
    assert.equal(unexplainedTotal(27_431, [pos(27_000)]), false);
  });

  test('a wallet whose positions are mostly unlisted still passes at twice over', () => {
    assert.equal(unexplainedTotal(60_000, [pos(30_000)]), false);
  });

  test('a small total is not worth doubting, whatever the ratio', () => {
    // A $900 header against $1 of positions is not how a foreign balance looks
    assert.equal(unexplainedTotal(900, [pos(1)]), false);
  });

  test('a header with nothing at all under it is refused', () => {
    assert.equal(unexplainedTotal(449_833, []), true);
  });
});
