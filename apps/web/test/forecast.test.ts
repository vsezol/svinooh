import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { forecast } from '@svinooh/ui/forecast';

const HOUR = 3_600_000;
const hours = (n: number) => Array.from({ length: n }, (_, i) => i * HOUR);

test('a steady line goes on at the same pace, from where it stands now', () => {
  const ahead = forecast([100, 102, 104, 106, 108], hours(5), null)!;
  assert.deepEqual(ahead.times, [4, 5, 6, 7, 8].map((n) => n * HOUR));
  assert.deepEqual(ahead.values, [108, 110, 112, 114, 116]);
});

test('it looks ahead as far as the window it learned from', () => {
  const values = [500, 500, 500, 100, 102, 104];
  const ahead = forecast(values, hours(6), 2 * HOUR)!;
  assert.deepEqual(ahead.values, [104, 106, 108]);
});

test('noise is averaged into one trend, anchored at the last reading', () => {
  const ahead = forecast([10, 14, 10, 14, 10, 14], hours(6), null)!;
  const slope = ahead.values[1] - ahead.values[0];
  const leastSquares = 6 / 17.5;
  assert.ok(Math.abs(slope - leastSquares) < 1e-9, String(slope));
  assert.equal(ahead.values[0], 14);
});

test('too little or flat-in-time history makes no forecast', () => {
  assert.equal(forecast([1, 2], hours(2), null), null);
  assert.equal(forecast([1, 2, 3], [0, 0, 0], null), null);
});
