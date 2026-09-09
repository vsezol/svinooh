import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { LENDERS, REPLAY_AT_REST, replayFrame } from '../src/lib/yield-replay';

const money = (s: string): number => Number(s.replace(/[+$,]/g, ''));

describe('ADayOfLendingReplayed', () => {
  test('starts at midnight with nothing accrued', () => {
    const frame = replayFrame(0);
    assert.equal(frame.clock, '00:00');
    assert.equal(frame.progress, 0);
    assert.equal(money(frame.total), 0);
    for (const row of frame.rows) assert.equal(row.fill, 0);
  });

  test('arrives at the end of the day and stops there', () => {
    const frame = replayFrame(REPLAY_AT_REST);
    assert.equal(frame.clock, '24:00');
    assert.equal(frame.progress, 1);
    assert.equal(frame.glow, 0);
    // The leader's bar is full; nobody else's is.
    const lead = frame.rows[0];
    assert.equal(Number(lead.fill.toFixed(6)), 1);
    for (const row of frame.rows.slice(1)) assert.ok(row.fill < 1);
  });

  test('holds on midnight rather than restarting early', () => {
    // Everything between the arrival and the end of the loop reads the same.
    const rest = replayFrame(REPLAY_AT_REST);
    const later = replayFrame(REPLAY_AT_REST + 1000);
    assert.equal(later.clock, rest.clock);
    assert.equal(later.total, rest.total);
  });

  test('never goes backwards through the day', () => {
    let last = -1;
    for (let t = 0; t <= REPLAY_AT_REST; t += 20) {
      const { progress } = replayFrame(t);
      assert.ok(progress >= last, `progress fell at ${t}`);
      last = progress;
    }
  });

  test('adds up: the total is what the rows say', () => {
    for (const t of [0, 1500, 4000, REPLAY_AT_REST]) {
      const frame = replayFrame(t);
      const rows = frame.rows.reduce((sum, r) => sum + money(r.earned), 0);
      // Each row is rounded to the cent before it is read back, so the sum of
      // four of them can differ from the total by a couple of cents.
      assert.ok(Math.abs(rows - money(frame.total)) < 0.03, `${rows} vs ${money(frame.total)} at ${t}`);
    }
  });

  test('pays a day of interest over a day, and no more', () => {
    const frame = replayFrame(REPLAY_AT_REST);
    for (const [i, lender] of LENDERS.entries()) {
      const day = (lender.suppliedUsd * lender.apy) / 100 / 365;
      assert.ok(Math.abs(money(frame.rows[i].earned) - day) < 0.01, lender.name);
    }
  });

  test('names every lender it draws a bar for', () => {
    assert.deepEqual(
      replayFrame(0).rows.map((r) => r.name),
      LENDERS.map((l) => l.name),
    );
  });
});
