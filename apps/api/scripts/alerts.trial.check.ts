/**
 * The trial verdicts and the renewal-reminder arming rules, exercised.
 *
 * All three are pure and all three guard messages to real people — a wrong
 * verdict is either spam or silence about money. Run with
 * `npm run -w apps/api check:trial`.
 */
import { judgeAlert } from '../src/alerts/trial.service';
import { expiredNoticeDue, reminderDue } from '../src/alerts/renewals.service';

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  );
};

const now = new Date('2026-09-04T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400e3);
const judge = (over: Partial<Parameters<typeof judgeAlert>[0]>) =>
  judgeAlert({ enforced: true, pro: false, alertsSent: 0, freeAlerts: 10, upsellAt: null, now, ...over });

/* ── триал алертов ── */

check('Pro шлёт всегда и мимо счётчика', judge({ pro: true, alertsSent: 999 }), { verdict: 'send', count: false });
check('стена выключена — шлём, но СЧИТАЕМ, чтобы включение началось с честных цифр', judge({ enforced: false, alertsSent: 999 }), { verdict: 'send', count: true });
check('внутри триала — шлём и считаем', judge({ alertsSent: 9 }), { verdict: 'send', count: true });
check('десятый потрачен — вместо алерта питч', judge({ alertsSent: 10 }), { verdict: 'upsell', count: false });
check('питч был час назад — молчим, маркетинг не рассылка', judge({ alertsSent: 10, upsellAt: new Date(now.getTime() - 3_600e3) }), { verdict: 'silent', count: false });
check('питч был сутки назад — можно снова', judge({ alertsSent: 10, upsellAt: days(-1) }), { verdict: 'upsell', count: false });

/* ── напоминание «скоро закончится» ── */

check('до конца 5 дней — рано', reminderDue(null, days(5), now), false);
check('до конца 2 дня, не напоминали — пора', reminderDue(null, days(2), now), true);
check('уже напомнили в этом периоде — молчим', reminderDue(now, days(2), now), false);
check('продлился — paidUntil уехал вперёд и напоминание взвелось само', reminderDue(now, days(32), new Date(days(30).getTime())), true);
check('уже истекло — это не «скоро закончится»', reminderDue(null, days(-1), now), false);

/* ── извещение «закончилось» ── */

check('ещё активна — молчим', expiredNoticeDue(null, days(1), now), false);
check('истекла вчера, не говорили — говорим', expiredNoticeDue(null, days(-1), now), true);
check('уже сказали после истечения — один раз и всё', expiredNoticeDue(now, days(-1), now), false);
check('продлился и истёк снова — говорим снова', expiredNoticeDue(days(-40), days(-1), now), true);
check('истекла неделю с лишним назад — не ноем вечно', expiredNoticeDue(null, days(-8), now), false);

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
