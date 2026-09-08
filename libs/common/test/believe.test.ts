import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { agree, moved } from '../src/believe';

describe('moved — is this reading far enough from the stored one to argue about', () => {
  test('a quiet cycle is not a move', () => {
    assert.equal(moved(100_000, 101_000), false);
    assert.equal(moved(100_000, 95_000), false);
  });

  test('a fall of more than a quarter is', () => {
    assert.equal(moved(100_000, 70_000), true);
  });

  test('a rise of more than a quarter is too — this is the direction that was missing', () => {
    assert.equal(moved(100_000, 200_000), true);
  });

  test('dust is left alone in both directions', () => {
    // A $2 wallet doubling is $2. Holding it for confirmation every cycle would
    // spend the arbitration where being wrong costs nothing.
    assert.equal(moved(2, 4), false);
    assert.equal(moved(20, 4), false);
  });

  test('money arriving on an empty address is a move', () => {
    assert.equal(moved(0, 5_000), true);
  });

  test('the readings from the incident, as the writer saw them', () => {
    // Each of these was believed on sight before the rise side existed
    assert.equal(moved(827, 449_833), true);
    assert.equal(moved(7, 449_833), true);
    assert.equal(moved(10_700, 183_789), true);
    assert.equal(moved(449_833, 1_166_714), true);
  });
});

describe('agree — do two readings taken seconds apart say the same thing', () => {
  test('the same number agrees with itself', () => {
    assert.equal(agree(7, 7), true);
  });

  test('a dusty wallet read twice agrees, however wide the ratio', () => {
    // $7 and $4 are 43% apart and are plainly the same answer: nothing here
    assert.equal(agree(7, 4), true);
  });

  test('two readings within a quarter agree', () => {
    assert.equal(agree(100_000, 90_000), true);
  });

  test('two readings a factor apart do not', () => {
    assert.equal(agree(100_000, 50_000), false);
  });

  test('$17 and $1,166,714 do not agree — the line that stored the incident', () => {
    assert.equal(agree(17, 1_166_714), false);
  });

  test('$85 and $8,139 do not agree either', () => {
    assert.equal(agree(85, 8_139), false);
  });

  test('order does not matter', () => {
    assert.equal(agree(1_166_714, 17), agree(17, 1_166_714));
    assert.equal(agree(90_000, 100_000), agree(100_000, 90_000));
  });
});

/**
 * The incident of 2026-09-08 on 0x7f5e…ba6a, replayed as the pair of decisions
 * the writer actually makes. The wallet held $7 throughout.
 */
describe('the incident, decided again under the new rule', () => {
  const believable = (previous: number, result: number, recheck: number | null): boolean =>
    !moved(previous, result) || (recheck !== null && agree(result, recheck));

  test('$449,833 → $17, re-read $1,166,714 is refused', () => {
    // The old rule stored the re-read here, because it was not itself a drop
    assert.equal(believable(449_833, 17, 1_166_714), false);
  });

  test('$449,833 → $85, re-read $8,139 is refused', () => {
    assert.equal(believable(449_833, 85, 8_139), false);
  });

  test('$449,833 → $7, re-read $4 is believed at once', () => {
    // Under the old rule this waited three cycles; the truth is corroborated
    // and there is nothing to wait for
    assert.equal(believable(449_833, 7, 4), true);
  });

  test('$1,166,714 → $7, re-read $7 is believed at once', () => {
    assert.equal(believable(1_166_714, 7, 7), true);
  });

  test('a rise with nothing to check it against is refused', () => {
    // What every one of the three bogus totals arrived as
    assert.equal(believable(827, 449_833, null), false);
  });

  test('a rise two readings agree on is believed — a real deposit still lands', () => {
    assert.equal(believable(1_000, 51_000, 51_010), true);
  });
});
