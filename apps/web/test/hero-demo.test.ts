import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  DEMO_AT_REST,
  SCENES,
  demoFrame,
  parts,
  sceneMs,
} from '../src/lib/hero-demo';

const CYCLE = SCENES.reduce((sum, s) => sum + sceneMs(s), 0);

/** Every 20ms of one whole cycle, which is finer than the 40ms it is drawn at. */
const everyFrame = (): number[] => Array.from({ length: Math.ceil(CYCLE / 20) }, (_, i) => i * 20);

describe('WhatThePanelUnderTheFieldIsDoing', () => {
  test('is never empty, at any instant of the cycle', () => {
    for (const t of everyFrame()) {
      const frame = demoFrame(t);
      // Either the trace is running or an answer is up — and an answer always
      // has words in it. An empty panel would change the card's height, which
      // would move the field somebody is typing in.
      if (frame.working) assert.ok(frame.steps.length > 0, `no steps at ${t}`);
      else assert.ok(frame.shown.answer.length > 0, `no answer at ${t}`);
    }
  });

  test('shows the previous answer while the next question types', () => {
    // One character in: the question has started, and what is on screen is
    // still the answer before it.
    const frame = demoFrame(60);
    assert.equal(frame.index, 0);
    assert.equal(frame.typed, 'w');
    assert.equal(frame.fading, true);
    assert.equal(frame.shown, SCENES[SCENES.length - 1]);
  });

  test('starts full rather than blank', () => {
    // t=0 is what the server renders and the browser hydrates against.
    const frame = demoFrame(0);
    assert.equal(frame.typed, '');
    assert.equal(frame.working, false);
    assert.equal(frame.shown, SCENES[SCENES.length - 1]);
  });

  test('has the question fully typed before the trace starts', () => {
    for (const [i, scene] of SCENES.entries()) {
      let before = 0;
      for (let k = 0; k < i; k += 1) before += sceneMs(SCENES[k]);
      // The first instant the trace is running for this scene.
      const t = everyFrame().find((at) => at >= before && demoFrame(at).working && demoFrame(at).index === i);
      assert.ok(t !== undefined, `${scene.q} never runs`);
      assert.equal(demoFrame(t).typed, scene.q);
    }
  });

  test('runs the trace one step at a time, in order', () => {
    for (const t of everyFrame()) {
      const frame = demoFrame(t);
      if (!frame.working) continue;
      const running = frame.steps.filter((s) => s.state === 'running');
      assert.ok(running.length <= 1, `${running.length} steps at once at ${t}`);
      // Done steps come first, then at most one running, then waiting: a trace
      // that skips around is not a trace of anything.
      const order = frame.steps.map((s) => s.state);
      const sorted = [...order].sort(
        (a, b) => ['done', 'running', 'waiting'].indexOf(a) - ['done', 'running', 'waiting'].indexOf(b),
      );
      assert.deepEqual(order, sorted, `out of order at ${t}`);
    }
  });

  test('lets a pressed example hold the panel for its own scene, then lets go', () => {
    const at = 4321;
    const picked = { index: 2, at };
    assert.equal(demoFrame(at + 10, picked).index, 2);
    assert.equal(demoFrame(at + sceneMs(SCENES[2]) - 10, picked).index, 2);
    // Past its own length the pick is spent and the cycle answers again —
    // wherever the clock has got to, which is not scene 2.
    const after = at + sceneMs(SCENES[2]) + 10;
    assert.equal(demoFrame(after, picked).index, demoFrame(after).index);
  });

  test('rests on a finished first answer for a reader who asked for less movement', () => {
    const frame = demoFrame(DEMO_AT_REST);
    assert.equal(frame.index, 0);
    assert.equal(frame.working, false);
    assert.equal(frame.fading, false);
    assert.equal(frame.shown, SCENES[0]);
  });
});

describe('HowAFigureInsideASentenceIsFound', () => {
  test('splits the backticked parts out and keeps the order', () => {
    assert.deepEqual(parts('Up `$7,522` this week'), [
      { text: 'Up ', mono: false },
      { text: '$7,522', mono: true },
      { text: ' this week', mono: false },
    ]);
  });

  test('drops nothing and invents nothing', () => {
    for (const scene of SCENES) {
      assert.equal(
        parts(scene.answer).map((p) => p.text).join(''),
        scene.answer.replace(/`/g, ''),
      );
    }
  });

  test('handles a figure at either end', () => {
    assert.deepEqual(parts('`Aave V3` pays'), [
      { text: 'Aave V3', mono: true },
      { text: ' pays', mono: false },
    ]);
    assert.deepEqual(parts('pays `6.8%`'), [
      { text: 'pays ', mono: false },
      { text: '6.8%', mono: true },
    ]);
  });
});
