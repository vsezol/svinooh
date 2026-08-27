/**
 * The transition rules, exercised.
 *
 * `decide` is the whole point of this service and it is pure, so it can be run
 * for real rather than reasoned about. Run with `npm run -w apps/monitor-alerts check`.
 */
import { decide, type Remembered, type Settings } from '../src/decide';
import type { WalletPositionState } from '@svinooh/shared';

const ON: Settings = { rangeAlerts: true, healthFactorBelow: 1.1, borrowApyAbove: 12 };
const pos = (p: Partial<WalletPositionState>): WalletPositionState => ({
  key: 'k', label: 'cbBTC/USDC', inRange: null, healthFactor: null, borrowApyPct: null, ...p,
});
const mem = (m: Partial<Remembered>): Map<string, Remembered> =>
  new Map([['k', { inRange: null, healthBreached: false, borrowBreached: false, ...m }]]);

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const kinds = (items: { kind: string; direction: string }[]) => items.map((i) => `${i.kind}:${i.direction}`);

check('первое появление в диапазоне — тихо',
  kinds(decide([pos({ inRange: true })], ON, new Map()).items), []);

check('первое появление ВНЕ диапазона — тоже тихо (это не событие этого скана)',
  kinds(decide([pos({ inRange: false })], ON, new Map()).items), []);

check('вышла из диапазона — одно событие',
  kinds(decide([pos({ inRange: false })], ON, mem({ inRange: true })).items), ['range:entered']);

check('висит вне диапазона — молчим',
  kinds(decide([pos({ inRange: false })], ON, mem({ inRange: false })).items), []);

check('вернулась — одно событие',
  kinds(decide([pos({ inRange: true })], ON, mem({ inRange: false })).items), ['range:recovered']);

check('первое появление с HF ниже порога — говорим сразу',
  kinds(decide([pos({ healthFactor: 1.05 })], ON, new Map()).items), ['health:entered']);

check('HF всё ещё низкий — молчим',
  kinds(decide([pos({ healthFactor: 1.02 })], ON, mem({ healthBreached: true })).items), []);

check('HF восстановился — говорим',
  kinds(decide([pos({ healthFactor: 1.4 })], ON, mem({ healthBreached: true })).items), ['health:recovered']);

check('ставка выше порога впервые — говорим',
  kinds(decide([pos({ borrowApyPct: 18 })], ON, new Map()).items), ['borrow:entered']);

check('порог не задан — ничего не сравниваем',
  kinds(decide([pos({ healthFactor: 0.2, borrowApyPct: 99 })],
    { rangeAlerts: true, healthFactorBelow: null, borrowApyAbove: null }, new Map()).items), []);

check('range выключен — событий нет',
  kinds(decide([pos({ inRange: false })], { ...ON, rangeAlerts: false }, mem({ inRange: true })).items), []);

check('range выключен — состояние забыто, чтобы включение обратно не выстрелило',
  decide([pos({ inRange: false })], { ...ON, rangeAlerts: false }, mem({ inRange: true })).next.get('k')?.inRange,
  null);

check('два порога сразу — два события',
  kinds(decide([pos({ healthFactor: 1.0, borrowApyPct: 20 })], ON, new Map()).items),
  ['health:entered', 'borrow:entered']);

check('значение и порог едут в событии',
  decide([pos({ healthFactor: 1.05 })], ON, new Map()).items.map((i) => [i.value, i.threshold]),
  [[1.05, 1.1]]);

console.log(failures ? `\n${failures} провалено` : '\nвсе проверки прошли');
process.exit(failures ? 1 : 0);
