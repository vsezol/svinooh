import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { BASES, netFlowsBasis, rawBasis, windowOf, type Flow, type Sample } from '../src/portfolio/performance';

const HOUR = 3_600_000;
/** A window that opens at t=0 and closes a day later, so weights read as fractions of a day */
const T0 = 0;
const DAY = 24 * HOUR;

const at = (hours: number, usd: number): Sample => ({ t: T0 + hours * HOUR, usd });
const flow = (hours: number, usd: number): Flow => ({ t: T0 + hours * HOUR, usd });

/** Two decimal places is plenty for money; the point is never the last cent */
const close = (actual: number | null, expected: number, within = 0.01): void => {
  assert.ok(actual !== null, 'expected a number, got null');
  assert.ok(
    Math.abs(actual - expected) <= within,
    `expected ${expected} +/- ${within}, got ${actual}`,
  );
};

describe('raw basis — what the page has always shown', () => {
  test('a rise is the difference, over the opening value', () => {
    const change = rawBasis.measure([at(0, 100_000), at(24, 110_000)], []);
    close(change.usd, 10_000);
    close(change.pct, 10);
  });

  test('flows are ignored entirely — that is the whole complaint', () => {
    // $5k withdrawn from $100k and nothing else happened
    const change = rawBasis.measure([at(0, 100_000), at(24, 95_000)], [flow(12, -5_000)]);
    close(change.usd, -5_000);
    close(change.pct, -5);
  });

  test('a window opening at zero reports 0%, not infinity', () => {
    const change = rawBasis.measure([at(0, 0), at(24, 5_000)], []);
    close(change.usd, 5_000);
    close(change.pct, 0);
  });

  test('one reading is not a window', () => {
    assert.deepEqual(rawBasis.measure([at(0, 100)], []), { usd: 0, pct: null });
  });

  test('the line is the readings themselves', () => {
    assert.deepEqual(rawBasis.line([at(0, 10), at(1, 20)], [flow(0, 999)]), [10, 20]);
  });
});

describe('net-flows basis — what the holdings did', () => {
  test('a withdrawal is not a loss', () => {
    // $100k, $5k taken out halfway, nothing else moved
    const change = netFlowsBasis.measure([at(0, 100_000), at(24, 95_000)], [flow(12, -5_000)]);
    close(change.usd, 0);
    close(change.pct, 0);
  });

  test('a deposit is not a gain', () => {
    const change = netFlowsBasis.measure([at(0, 100_000), at(24, 105_000)], [flow(12, 5_000)]);
    close(change.usd, 0);
    close(change.pct, 0);
  });

  test('a real gain survives a deposit that happened alongside it', () => {
    // $100k, $5k deposited at the halfway mark, ends at $106k — so $1k was made
    const change = netFlowsBasis.measure([at(0, 100_000), at(24, 106_000)], [flow(12, 5_000)]);
    close(change.usd, 1_000);
    // Modified Dietz: the deposit was present for half the window, so the base
    // is 100_000 + 5_000 * 0.5 = 102_500
    close(change.pct, (1_000 / 102_500) * 100);
  });

  test('money that arrives at the end barely counts towards the base', () => {
    // The same $1k made, but the deposit landed with an hour to go
    const change = netFlowsBasis.measure([at(0, 100_000), at(24, 106_000)], [flow(23, 5_000)]);
    close(change.usd, 1_000);
    close(change.pct, (1_000 / (100_000 + 5_000 * (1 / 24))) * 100);
  });

  test('with no flows it agrees with the raw basis exactly', () => {
    const samples = [at(0, 100_000), at(12, 103_000), at(24, 110_000)];
    assert.deepEqual(netFlowsBasis.measure(samples, []), rawBasis.measure(samples, []));
  });

  test('a portfolio opened from nothing and emptied has money but no rate', () => {
    // Deposited $10k, withdrew $10k, ends where it started at zero
    const change = netFlowsBasis.measure(
      [at(0, 0), at(24, 0)],
      [flow(1, 10_000), flow(23, -10_000)],
    );
    close(change.usd, 0);
    // base = 0 + 10_000*(23/24) - 10_000*(1/24) which is positive, so a rate exists
    assert.notEqual(change.pct, null);
  });

  test('a base that comes to zero refuses to quote a rate', () => {
    // Nothing at the start and nothing weighted in: a flow exactly on the
    // closing edge contributes zero to the base
    const change = netFlowsBasis.measure([at(0, 0), at(24, 5_000)], [flow(24, 5_000)]);
    close(change.usd, 0);
    assert.equal(change.pct, null);
  });

  test('a flow on the opening edge belongs to the balance, not the window', () => {
    // The reading at t0 already includes it, so counting it again would say the
    // portfolio lost the deposit it is standing on
    const change = netFlowsBasis.measure([at(0, 105_000), at(24, 105_000)], [flow(0, 5_000)]);
    close(change.usd, 0);
    close(change.pct, 0);
  });

  test('the line removes the step and keeps the shape', () => {
    // Flat at $100k, $5k withdrawn between the second and third reading
    const line = netFlowsBasis.line(
      [at(0, 100_000), at(6, 100_000), at(12, 95_000), at(24, 95_000)],
      [flow(9, -5_000)],
    );
    assert.deepEqual(line, [100_000, 100_000, 100_000, 100_000]);
  });

  test('an unpriced flow is simply not in the list and the step stays', () => {
    // toSignedFlows drops what nobody could price, so the line here is the raw
    // one — understating a correction rather than inventing one
    const line = netFlowsBasis.line([at(0, 100_000), at(24, 95_000)], []);
    assert.deepEqual(line, [100_000, 95_000]);
  });
});

describe('windowOf — the stretch the period button is asking about', () => {
  const series = [at(0, 1), at(12, 2), at(24, 3), at(36, 4), at(48, 5)];

  test('a day of a two-day series is its last day', () => {
    assert.deepEqual(
      windowOf(series, DAY).map((s) => s.usd),
      [3, 4, 5],
    );
  });

  test('`all` has no width and takes everything', () => {
    assert.equal(windowOf(series, null).length, series.length);
  });

  test('a window wider than the history is the whole history', () => {
    assert.equal(windowOf(series, 30 * DAY).length, series.length);
  });

  test('a window narrower than the gap between the last two readings keeps two', () => {
    // Never one point: a change needs something to change from
    assert.equal(windowOf(series, 1).length, series.length);
  });
});

describe('the two bases are addressable by name', () => {
  test('every basis in the record answers to its own id', () => {
    for (const [key, strategy] of Object.entries(BASES)) assert.equal(strategy.basis, key);
  });
});
