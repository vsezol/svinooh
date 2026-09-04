/**
 * A live smoke against NOWPayments' sandbox: is the API up, does our key
 * open invoices at both of our prices, and do the per-coin minimums actually
 * fit the 2 USD welcome invoice — the one question their docs answer with
 * "about $2 for some coins and $3-5 for others".
 *
 * Wants the SANDBOX key (account.sandbox.nowpayments.io); without one it
 * skips and exits 0 — this is an on-demand check, not a build gate. It calls
 * the real internet and creates real (play-money) invoices; the printed
 * invoice URLs can be opened to eyeball the hosted page.
 *
 *   NOWPAYMENTS_API_KEY=xxx npm run -w apps/api check:sandbox
 */
import { NowPaymentsClient } from '../src/billing/nowpayments.client';
import { setting } from '@svinooh/common';

const key = process.env.NOWPAYMENTS_API_KEY || '';
const apiUrl = (process.env.NOWPAYMENTS_API_URL || 'https://api-sandbox.nowpayments.io/v1').replace(/\/+$/, '');

/** The rails our users actually hold, as NOWPayments spells them */
const RAILS = ['usdttrc20', 'usdtbsc', 'ton', 'sol'];

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  );
};

async function main(): Promise<void> {
  if (!key) {
    console.log('skipped — set NOWPAYMENTS_API_KEY (the sandbox key from account.sandbox.nowpayments.io)');
    process.exit(0);
  }

  /* ── the API is up at all ── */
  const status = await fetch(`${apiUrl}/status`, { signal: AbortSignal.timeout(15_000) })
    .then((res) => res.json() as Promise<{ message?: string }>)
    .catch((error: Error) => ({ message: `unreachable: ${error.message}` }));
  check(`API отвечает (${apiUrl})`, status.message, 'OK');

  /* ── both of our prices open a real invoice ── */
  const client = new NowPaymentsClient(key, '', apiUrl);
  for (const [label, priceUsd] of [
    ['первый месяц', setting('billing.firstMonthUsd')],
    ['обычный месяц', setting('billing.proPriceUsd')],
  ] as const) {
    try {
      const invoice = await client.createInvoice({
        priceUsd,
        orderId: `sandbox-check-${Date.now()}-${priceUsd}`,
        description: `Svinooh.Pro sandbox check — ${label}`,
        ipnUrl: null,
        successUrl: 'https://svinooh.com/pro?paid=1',
        cancelUrl: 'https://svinooh.com/pro',
      });
      check(`инвойс на $${priceUsd} (${label}) открывается`, invoice.url.startsWith('http'), true);
      console.log(`      ${invoice.url}`);
    } catch (error) {
      failures++;
      console.log(`FAIL  инвойс на $${priceUsd} (${label}): ${(error as Error).message}`);
    }
  }

  /* ── per-coin minimums against the welcome price ── */
  const welcome = setting('billing.firstMonthUsd');
  for (const rail of RAILS) {
    const answer = await fetch(
      `${apiUrl}/min-amount?currency_from=${rail}&currency_to=${rail}&fiat_equivalent=usd`,
      { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15_000) },
    )
      .then((res) => res.json() as Promise<{ min_amount?: number; fiat_equivalent?: number }>)
      .catch((error: Error) => ({ min_amount: undefined, fiat_equivalent: undefined, error: error.message }));
    const usd = answer.fiat_equivalent;
    if (typeof usd !== 'number') {
      // The shape is theirs to change and this probe is advisory — say what
      // came back instead of failing the run on it
      console.log(`warn  ${rail}: минимум не прочитался — ${JSON.stringify(answer)}`);
      continue;
    }
    const fits = usd <= welcome;
    console.log(
      `${fits ? 'ok  ' : 'warn'}  ${rail}: минимум ~$${usd}${fits ? '' : ` — НЕ влезает в первый месяц за $${welcome}; эта монета спрячется с инвойса`}`,
    );
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
  process.exit(failures ? 1 : 0);
}

void main().catch((error: Error) => {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
});
