import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { forecast } from '@svinooh/ui/forecast';

const HOUR = 3_600_000;
const hours = (n: number) => Array.from({ length: n }, (_, i) => i * HOUR);

test('a steady line is its own trend, and goes on at the same pace', () => {
  const result = forecast([100, 102, 104, 106, 108], hours(5), null)!;
  assert.deepEqual(result.trend.values, [100, 102, 104, 106, 108]);
  assert.deepEqual(result.ahead.times, [4, 5, 6, 7, 8].map((n) => n * HOUR));
  assert.deepEqual(result.ahead.values, [108, 110, 112, 114, 116]);
});

test('the forecast starts on the trend line, not on the last reading', () => {
  const result = forecast([10, 14, 10, 14, 10, 14], hours(6), null)!;
  const slope = 6 / 17.5;
  const atNow = 12 + slope * (5 - 2.5);
  assert.ok(Math.abs(result.ahead.values[0] - atNow) < 1e-9, String(result.ahead.values[0]));
  assert.ok(Math.abs(result.trend.values[5] - atNow) < 1e-9, 'the trend ends where the forecast begins');
  assert.ok(Math.abs(result.ahead.values[1] - result.ahead.values[0] - slope) < 1e-9);
});

test('it learns from the window on screen and looks as far ahead', () => {
  const result = forecast([500, 500, 500, 100, 102, 104], hours(6), 2 * HOUR)!;
  assert.equal(result.from, 3);
  assert.deepEqual(result.trend.values, [100, 102, 104]);
  assert.deepEqual(result.ahead.values, [104, 106, 108]);
});

test('too little or flat-in-time history makes no forecast', () => {
  assert.equal(forecast([1, 2], hours(2), null), null);
  assert.equal(forecast([1, 2, 3], [0, 0, 0], null), null);
});
