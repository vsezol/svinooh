import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { secs, traceOf } from '../src/app/trace';
import type { StepEvent } from '../src/app/wire';

const done = (id: string, ms: number, label = id): StepEvent => ({ id, label, state: 'done', ms });
const running = (id: string, startedAt: number, label = id): StepEvent => ({
  id,
  label,
  state: 'running',
  startedAt,
});

describe('HowLongSomethingTookIsRead', () => {
  test('reads a short operation to the hundredth', () => {
    // The whole point: 40ms used to read "0.0s", which says it took no time
    // rather than that it was fast.
    assert.equal(secs(40), '0.04s');
    assert.equal(secs(5), '0.01s');
    assert.equal(secs(940), '0.94s');
  });

  test('reads a long one to the tenth, where a hundredth is noise', () => {
    assert.equal(secs(1000), '1.0s');
    assert.equal(secs(4620), '4.6s');
  });

  test('never reads as nothing at all for work that ran', () => {
    for (const ms of [1, 9, 40, 120, 999]) {
      assert.notEqual(secs(ms), '0.0s', `${ms}ms`);
    }
  });
});

describe('WhatTheReceiptSays', () => {
  test('gives every finished step the time it actually took', () => {
    const block = traceOf([done('route', 1900, 'Reading the question'), done('answer', 40)], false, 0);
    assert.deepEqual(
      block.steps.map((s) => [s.label, s.state, s.time]),
      [
        ['Reading the question', 'done', '1.9s'],
        ['answer', 'done', '0.04s'],
      ],
    );
  });

  test('counts a running step up from when its line appeared', () => {
    // A spinner with no number beside it is the thing that reads as frozen.
    const block = traceOf([running('think-0', 1_000)], false, 3_400);
    assert.equal(block.steps[0].state, 'running');
    assert.equal(block.steps[0].time, '2.4s');
  });

  test('says nothing about a running step when no clock is ticking', () => {
    // A finished receipt, re-read later: there is nothing left to count.
    assert.equal(traceOf([running('think-0', 1_000)], true, 0).steps[0].time, undefined);
  });

  test('never counts backwards when the clock and the event disagree', () => {
    assert.equal(traceOf([running('x', 5_000)], false, 4_000).steps[0].time, '0.00s');
  });

  test('sums the receipt out of what the steps reported', () => {
    const block = traceOf([done('a', 1_500), done('b', 600)], true, 0);
    assert.equal(block.summary, '2 steps · 2.1s');
    assert.equal(traceOf([done('a', 900)], true, 0).summary, '1 step · 0.90s');
  });

  test('is folded or open exactly as it is asked to be', () => {
    assert.equal(traceOf([done('a', 10)], true, 0).collapsed, true);
    assert.equal(traceOf([done('a', 10)], false, 0).collapsed, false);
  });

  test('falls back to a step id when the service sent no label', () => {
    const block = traceOf([{ id: 'history_summary · 7d', state: 'done', ms: 100 }], false, 0);
    assert.equal(block.steps[0].label, 'history_summary · 7d');
  });
});
