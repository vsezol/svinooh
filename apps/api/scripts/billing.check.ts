/**
 * The billing arithmetic and the webhook cryptography, exercised.
 *
 * Everything here is pure — offer math, month arithmetic, signature schemes,
 * status mapping — so it can be run for real rather than reasoned about.
 * Run with `npm run -w apps/api check`.
 */
import { addMonths, buildOffer, paywallBody, utcDay } from '../src/billing/premium';
import {
  ipnSignature,
  ipnSignatureValid,
  paymentStatusOf,
  sortedJson,
} from '../src/billing/nowpayments.client';
import {
  cryptomusSign,
  cryptomusStatusOf,
  cryptomusWebhookValid,
  phpJson,
} from '../src/billing/cryptomus.client';

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  );
};

const LIMITS = {
  freeAlerts: 10,
  freePortfolios: 1,
  freeWalletsPerPortfolio: 5,
  freeHistoryDays: 7,
  freeAiPerDay: 1,
};

/* ── оффер ── */

const offer = buildOffer({ priceUsd: 5, wasPriceUsd: 10, firstMonthUsd: 2, limits: LIMITS });
check('скидка считается от зачёркнутой цены: 5 вместо 10 — 50%', offer.discountPct, 50);
check('первый месяц: 2 вместо 10 — 80%', offer.firstMonthDiscountPct, 80);
check(
  'зачёркнутая цена не выше живой — скидки нет, а не отрицательная',
  buildOffer({ priceUsd: 10, wasPriceUsd: 5, firstMonthUsd: 2, limits: LIMITS }).discountPct,
  0,
);

const wall = paywallBody('history', offer);
check('паywall несёт код, фичу и весь оффер', [wall.statusCode, wall.code, wall.feature], [402, 'PRO_REQUIRED', 'history']);
check('в тексте паywall — сегодняшние цены', wall.message.includes('$5/month instead of $10'), true);

/* ── календарный месяц ── */

const iso = (d: Date) => d.toISOString().slice(0, 10);
check('31 января + месяц — 28 февраля, не 3 марта', iso(addMonths(new Date('2026-01-31T12:00:00Z'), 1)), '2026-02-28');
check('високосный февраль — 29-е', iso(addMonths(new Date('2028-01-31T00:00:00Z'), 1)), '2028-02-29');
check('31 августа + месяц — 30 сентября', iso(addMonths(new Date('2026-08-31T00:00:00Z'), 1)), '2026-09-30');
check('обычный день просто переезжает', iso(addMonths(new Date('2026-12-15T00:00:00Z'), 1)), '2027-01-15');
check('время суток продления не теряется', addMonths(new Date('2026-09-04T17:45:00Z'), 1).toISOString(), '2026-10-04T17:45:00.000Z');
check('utcDay — день по UTC', utcDay(new Date('2026-09-04T23:59:59Z')), '2026-09-04');

/* ── NOWPayments: сортированный JSON и HMAC ── */

check(
  'sortedJson не зависит от порядка ключей, на любой глубине',
  sortedJson({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } }),
  sortedJson({ a: { c: [{ e: 4, f: 3 }], d: 2 }, b: 1 }),
);
const npBody = { payment_status: 'finished', order_id: 'pro_x', actually_paid: 5 };
const npSig = ipnSignature(npBody, 'secret');
check('подпись сходится на теле с другим порядком ключей', ipnSignatureValid({ actually_paid: 5, order_id: 'pro_x', payment_status: 'finished' }, npSig, 'secret'), true);
check('подменённое тело — не сходится', ipnSignatureValid({ ...npBody, actually_paid: 500 }, npSig, 'secret'), false);
check('без заголовка — не сходится', ipnSignatureValid(npBody, undefined, 'secret'), false);
check('без секрета — не сходится, а не «всё подписано»', ipnSignatureValid(npBody, npSig, ''), false);
check(
  'статусы NOWPayments ложатся в наши',
  ['finished', 'partially_paid', 'waiting', 'confirmed', 'sending', 'failed', 'refunded', 'expired', 'novel'].map(paymentStatusOf),
  ['paid', 'underpaid', 'waiting', 'confirming', 'confirming', 'failed', 'refunded', 'expired', null],
);

/* ── Cryptomus: json_encode по-пэхэпэшному и md5(base64+key) ── */

check('слэши экранируются как в json_encode', phpJson({ u: 'https://x/y' }), '{"u":"https:\\/\\/x\\/y"}');
check('не-ASCII экранируется как \\uXXXX', phpJson({ s: 'я' }), '{"s":"\\u044f"}');
const cmBody: Record<string, unknown> = { order_id: 'pro_y', status: 'paid', amount: '5.00' };
const cmSigned = { ...cmBody, sign: cryptomusSign(cmBody, 'key') };
check('вебхук с подписью без поля sign — сходится', cryptomusWebhookValid(cmSigned, 'key'), true);
check('чужой ключ — не сходится', cryptomusWebhookValid(cmSigned, 'other'), false);
check('без sign — не сходится', cryptomusWebhookValid(cmBody, 'key'), false);
check('без ключа — не сходится', cryptomusWebhookValid(cmSigned, ''), false);
check(
  'статусы Cryptomus ложатся в наши, paid_over — это paid',
  ['check', 'process', 'confirm_check', 'paid', 'paid_over', 'wrong_amount', 'fail', 'system_fail', 'cancel', 'refund_paid', 'locked'].map(cryptomusStatusOf),
  ['waiting', 'confirming', 'confirming', 'paid', 'paid', 'underpaid', 'failed', 'failed', 'expired', 'refunded', null],
);

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
