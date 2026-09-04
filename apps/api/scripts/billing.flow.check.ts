/**
 * The whole payment flow, run for real: checkout against a fake NOWPayments
 * server (so the client's HTTP path and request shape are exercised, not
 * mocked), webhooks signed with the real HMAC and pushed through the same
 * service method the controller calls, and the money rules checked against
 * the local Postgres — one month per payment however the webhooks arrive,
 * the welcome price spent only by a FINISHED payment, the gates opening on
 * Pro and closing on the free plan.
 *
 * Needs the dev database (`npm run db:up`, migrations applied). Everything it
 * writes is namespaced `billing-check-*` and deleted on the way out, so it is
 * safe to run beside a working dev stack.
 * Run with `npm run -w apps/api check:flow`.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  );
};

/** Close enough for a timestamp computed a query earlier */
const near = (got: Date, want: Date) => Math.abs(got.getTime() - want.getTime()) < 5 * 60_000;

interface SeenRequest {
  path: string;
  apiKey: string | undefined;
  body: Record<string, unknown>;
}

async function main(): Promise<void> {
  /* ── a NOWPayments that lives on localhost ── */
  const seen: SeenRequest[] = [];
  const fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      seen.push({
        path: req.url ?? '',
        apiKey: req.headers['x-api-key'] as string | undefined,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ id: `inv-${seen.length}`, invoice_url: `https://fake.gateway/pay/inv-${seen.length}` }),
      );
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const port = (fake.address() as AddressInfo).port;

  /* ── the environment, before any module reads it ── */
  process.env.BILLING_ENFORCE = 'on'; // the gates are half of what is bought
  process.env.NOWPAYMENTS_API_KEY = 'check-key';
  process.env.NOWPAYMENTS_IPN_SECRET = 'check-secret';
  process.env.NOWPAYMENTS_API_URL = `http://127.0.0.1:${port}/v1`;

  const { PrismaService } = await import('@svinooh/db');
  const { RabbitService, setting } = await import('@svinooh/common');
  const { NowPaymentsClient, ipnSignature } = await import('../src/billing/nowpayments.client');
  const { PremiumService } = await import('../src/billing/premium.service');
  const { BillingService } = await import('../src/billing/billing.service');
  const { addMonths } = await import('../src/billing/premium');
  const { config } = await import('../src/config');
  const { HttpException } = await import('@nestjs/common');

  const prisma = new PrismaService();
  const premium = new PremiumService(prisma);
  const billing = new BillingService(
    prisma,
    premium,
    new NowPaymentsClient(config.nowpaymentsApiKey, config.nowpaymentsIpnSecret, config.nowpaymentsApiUrl),
    new RabbitService(null), // disabled — the thank-you publish is a no-op here
  );

  /** A signed webhook body, exactly as NOWPayments would send it */
  const ipn = (orderId: string, status: string, extra: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> = {
      payment_id: 4242,
      order_id: orderId,
      payment_status: status,
      pay_currency: 'usdttrc20',
      actually_paid: 5,
      ...extra,
    };
    return { body, sig: ipnSignature(body, 'check-secret') };
  };

  const cleanup = async () => {
    await prisma.portfolio.deleteMany({ where: { slug: { startsWith: 'billing-check-' } } });
    await prisma.user.deleteMany({ where: { devKey: { startsWith: 'billing-check-' } } });
  };
  await cleanup(); // a failed earlier run must not haunt this one

  try {
    const a = await prisma.user.create({ data: { devKey: 'billing-check-a' } });
    const b = await prisma.user.create({ data: { devKey: 'billing-check-b' } });
    const c = await prisma.user.create({ data: { devKey: 'billing-check-c' } });

    /* ── checkout: the welcome price, and our numbers reaching the gateway ── */

    const co1 = await billing.checkout(a.id);
    const pay1 = await prisma.payment.findFirstOrThrow({ where: { userId: a.id } });
    check('первый чекаут — цена первого месяца', pay1.priceUsd, setting('billing.firstMonthUsd'));
    check('строка платежа ждёт и помнит счёт', [pay1.status, pay1.provider, pay1.invoiceUrl !== null], ['waiting', 'nowpayments', true]);
    check(
      'в шлюз ушли наши цифры под нашим ключом',
      [seen[0].path, seen[0].apiKey, seen[0].body.price_amount, seen[0].body.price_currency, seen[0].body.order_id],
      ['/v1/invoice', 'check-key', setting('billing.firstMonthUsd'), 'usd', pay1.orderId],
    );
    check('юзеру отдана ссылка шлюза', co1.url, 'https://fake.gateway/pay/inv-1');

    /* ── the finished webhook: one month, exactly once ── */

    const fin1 = ipn(pay1.orderId, 'finished', { actually_paid: 2 });
    await billing.nowpaymentsWebhook(fin1.body, fin1.sig);
    const paid1 = await prisma.payment.findUniqueOrThrow({ where: { id: pay1.id } });
    check('finished — платёж оплачен и датирован', [paid1.status, paid1.paidAt !== null, paid1.paidAmount], ['paid', true, 2]);
    const sub1 = await prisma.subscription.findUniqueOrThrow({ where: { userId: a.id } });
    check('подписка — календарный месяц от сейчас', near(sub1.paidUntil, addMonths(new Date(), 1)), true);
    check('isPro говорит да', await premium.isPro(a.id), true);

    await billing.nowpaymentsWebhook(fin1.body, fin1.sig);
    const subReplay = await prisma.subscription.findUniqueOrThrow({ where: { userId: a.id } });
    check('повторный finished не дарит второй месяц', subReplay.paidUntil.getTime(), sub1.paidUntil.getTime());

    const late = ipn(pay1.orderId, 'waiting');
    await billing.nowpaymentsWebhook(late.body, late.sig);
    check(
      'опоздавший waiting не разжалует paid',
      (await prisma.payment.findUniqueOrThrow({ where: { id: pay1.id } })).status,
      'paid',
    );

    /* ── renewal: full price, stacked on the paid-until date ── */

    await billing.checkout(a.id);
    const pay2 = await prisma.payment.findFirstOrThrow({
      where: { userId: a.id, status: 'waiting' },
      orderBy: { createdAt: 'desc' },
    });
    check('второй месяц — обычная цена, не промо', pay2.priceUsd, setting('billing.proPriceUsd'));
    const fin2 = ipn(pay2.orderId, 'finished');
    await billing.nowpaymentsWebhook(fin2.body, fin2.sig);
    const sub2 = await prisma.subscription.findUniqueOrThrow({ where: { userId: a.id } });
    check('раннее продление стакается от paidUntil, не от сейчас', near(sub2.paidUntil, addMonths(sub1.paidUntil, 1)), true);

    const meA = await billing.me(a.id);
    check('me: Pro, промо истрачено, оба платежа в истории', [meA.pro, meA.firstMonthEligible, meA.payments.length], [true, false, 2]);

    /* ── underpayment: observed, recorded, nothing granted ── */

    await billing.checkout(b.id);
    const payB = await prisma.payment.findFirstOrThrow({ where: { userId: b.id } });
    const part = ipn(payB.orderId, 'partially_paid', { actually_paid: 1 });
    await billing.nowpaymentsWebhook(part.body, part.sig);
    check(
      'недоплата — underpaid, месяц не начислен',
      [
        (await prisma.payment.findUniqueOrThrow({ where: { id: payB.id } })).status,
        await prisma.subscription.findUnique({ where: { userId: b.id } }),
        await premium.isPro(b.id),
      ],
      ['underpaid', null, false],
    );
    check('недоплата не съедает промо первого месяца', (await billing.me(b.id)).firstMonthEligible, true);

    /* ── the doors nobody signed ── */

    let refused = 0;
    try {
      await billing.nowpaymentsWebhook(fin1.body, 'deadbeef');
    } catch (error) {
      refused = error instanceof HttpException ? error.getStatus() : -1;
    }
    check('битая подпись — 401, до денег не доходит', refused, 401);

    const ghost = ipn('pro_never_existed', 'finished');
    await billing.nowpaymentsWebhook(ghost.body, ghost.sig); // logs loudly, must not throw
    check('чужой order_id — молча в лог, ничего не создано', await prisma.payment.count({ where: { orderId: 'pro_never_existed' } }), 0);

    /* ── the gates: what the money actually buys ── */

    const freePortfolios = setting('billing.freePortfolios');
    for (let i = 0; i < freePortfolios; i++) {
      await premium.assertAnotherPortfolio(c.id); // still under the limit
      await prisma.portfolio.create({
        data: { slug: `billing-check-${i}-${c.id.slice(-6)}`, owner: { create: { userId: c.id } } },
      });
    }
    let walled = 0;
    try {
      await premium.assertAnotherPortfolio(c.id);
    } catch (error) {
      walled = error instanceof HttpException ? error.getStatus() : -1;
    }
    check('лимит портфелей — 402 для free', walled, 402);
    await premium.assertAnotherPortfolio(a.id); // must not throw
    check('лимит портфелей не существует для Pro', true, true);

    check(
      'кошельки и история: free ограничен ручками, Pro — нет',
      [await premium.walletCap(c.id), await premium.historyDays(c.id), await premium.walletCap(a.id), await premium.historyDays(a.id)],
      [setting('billing.freeWalletsPerPortfolio'), setting('billing.freeHistoryDays'), null, null],
    );

    const freeAi = setting('billing.freeAiPerDay');
    for (let i = 0; i < freeAi; i++) await premium.consumeAi(c.id);
    let aiWalled = 0;
    try {
      await premium.consumeAi(c.id);
    } catch (error) {
      aiWalled = error instanceof HttpException ? error.getStatus() : -1;
    }
    check('дневная квота агента — 402 сверх лимита', aiWalled, 402);
    await premium.consumeAi(a.id); // Pro is not metered
    check('агент для Pro без счётчика', true, true);
  } finally {
    await cleanup();
    await prisma.$disconnect();
    fake.close();
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
  process.exit(failures ? 1 : 0);
}

void main().catch((error: Error) => {
  console.error(`FAIL  the flow itself fell over: ${error.message}`);
  process.exit(1);
});
