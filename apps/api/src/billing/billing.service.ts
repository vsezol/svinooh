import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Payment } from '@prisma/client';
import { BILLING_QUEUE, option, QueueService, setting } from '@svinooh/common';
import type { BillingMeDto, BillingNotice, CheckoutDto } from '@svinooh/shared';
import { PrismaService } from '@svinooh/db';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { NowPaymentsClient, paymentStatusOf } from './nowpayments.client';
import { addMonths, coinLock, utcDay } from './premium';
import { PremiumService } from './premium.service';

/** Statuses whose invoice can still be paid, or is being paid right now */
const OPEN = new Set(['waiting', 'confirming']);

/**
 * How long an attempt with no invoice yet counts as still talking to the
 * gateway. Past it, the request that made it is gone — a crash, a timeout —
 * and holding its key any longer would wedge every retry under it.
 */
const IN_FLIGHT_MS = 60_000;

const inProgress = (): ConflictException =>
  new ConflictException({
    statusCode: 409,
    code: 'CHECKOUT_IN_PROGRESS',
    message: 'This checkout is still opening. Try again in a moment.',
  });

/**
 * The money itself: opening a checkout, believing a webhook, moving paidUntil.
 *
 * A "subscription" here is prepaid time — crypto has no dependable auto-debit,
 * so every month is its own invoice and the renewal reminders (the billing
 * sweep in monitor-alerts) stand in for a charge on file. What this service
 * guards above all is the one irreversible step: a payment counts towards
 * paidUntil exactly once, however many times and in whatever order its
 * webhooks arrive.
 *
 * NOWPayments is the gateway, singular; everything specific to it lives in
 * nowpayments.client.ts, so a replacement is that file and one webhook route.
 * `Payment.provider` still records who carried each payment — history must
 * outlive any such swap.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly premium: PremiumService,
    private readonly nowpayments: NowPaymentsClient,
    private readonly queue: QueueService,
  ) {}

  /** What this account pays for its next month — the welcome price while it applies */
  private async nextPriceUsd(userId: string): Promise<{ priceUsd: number; firstMonth: boolean }> {
    const firstMonth = await this.firstMonthEligible(userId);
    return {
      firstMonth,
      priceUsd: firstMonth ? setting('billing.firstMonthUsd') : setting('billing.proPriceUsd'),
    };
  }

  /** code → its USD minimum as last read, believed for half an hour — fees drift, not spike */
  private readonly minKnown = new Map<string, { usd: number | null; at: number }>();

  /**
   * The coin the billing.payCoin knob locks this invoice to, or null for the
   * gateway's open page — including when the knob's coin cannot carry the
   * price. The operator hears about that in the log, the payer never does:
   * their checkout simply offers the full list instead of a dead invoice.
   */
  private async lockFor(priceUsd: number): Promise<string | null> {
    const coin = option('billing.payCoin');
    if (coin === 'page') return null;
    const known = this.minKnown.get(coin);
    let minUsd = known !== undefined && Date.now() - known.at < 30 * 60_000 ? known.usd : undefined;
    if (minUsd === undefined) {
      minUsd = await this.nowpayments.minAmountUsd(coin).catch(() => null);
      this.minKnown.set(coin, { usd: minUsd, at: Date.now() });
    }
    const lock = coinLock(coin, minUsd, priceUsd);
    if (lock === null) {
      this.logger.warn(
        `billing.payCoin=${coin} cannot carry ${priceUsd} usd (network minimum ${minUsd ?? 'unknown'}) — falling back to the gateway's own coin page`,
      );
    }
    return lock;
  }

  async me(userId: string): Promise<BillingMeDto> {
    const now = new Date();
    const [sub, usage, portfolios, payments, next] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId }, select: { paidUntil: true } }),
      this.prisma.featureUsage.findUnique({ where: { userId } }),
      this.prisma.portfolioOwner.count({ where: { userId } }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.nextPriceUsd(userId),
    ]);
    return {
      pro: sub !== null && sub.paidUntil > now,
      paidUntil: sub?.paidUntil.toISOString() ?? null,
      firstMonthEligible: next.firstMonth,
      offer: this.premium.offer(),
      usage: {
        portfolios,
        alertsSent: usage?.alertsSent ?? 0,
        aiUsedToday: usage?.aiDay === utcDay(now) ? usage.aiUsed : 0,
      },
      payments: payments.map((p) => ({
        id: p.id,
        status: p.status,
        priceUsd: p.priceUsd,
        months: p.months,
        // Only while it could still be paid — a link to a dead invoice is bait
        invoiceUrl: p.status === 'waiting' || p.status === 'created' ? p.invoiceUrl : null,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * One month of Pro, priced at the welcome offer while this account has never
   * finished a payment. The Payment row exists BEFORE the gateway hears the
   * order id, so its webhook can never name an order we do not know.
   *
   * Which coin the invoice opens on is the billing.payCoin tunable: 'page'
   * hands the choice to the gateway's own page (its list is curated in the
   * NOWPayments dashboard, and it hides sub-minimum coins by itself); a coin
   * locks the invoice to it — checked against its live network minimum first,
   * because a lock below the minimum is a dead invoice (USDT-TRC20 sits above
   * 11 USD as of 2026-09), and falling back to the open page is never wrong.
   *
   * `key` is the Idempotency-Key the client sent, naming one attempt to pay.
   * Asked again under it — a retry after a lost response, a second click, the
   * page brought back from the invoice tab — checkout answers with the invoice
   * that attempt opened instead of a second one, for as long as it can still
   * be paid. Without a key every call is a new attempt, as before.
   */
  async checkout(userId: string, key: string | null = null): Promise<CheckoutDto> {
    if (!this.nowpayments.enabled) {
      throw new ServiceUnavailableException('Payments are not configured yet');
    }
    if (key !== null) {
      const answered = await this.answeredBefore(userId, key);
      if (answered) return answered;
    }
    const { priceUsd, firstMonth } = await this.nextPriceUsd(userId);
    const lock = await this.lockFor(priceUsd);

    let payment: Payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          userId,
          provider: 'nowpayments',
          // Opaque on purpose: an order id leaks into gateway dashboards and
          // webhook logs, and portfolio slugs went wordy — money stays boring
          orderId: `pro_${randomUUID()}`,
          months: 1,
          priceUsd,
          // What the invoice is locked to; the webhook overwrites it with what
          // was actually paid
          payCurrency: lock,
          idempotencyKey: key,
        },
      });
    } catch (err) {
      // The same key a moment ago, from a request still at the gateway: the
      // unique index let one row in, and this is the other request
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw inProgress();
      }
      throw err;
    }

    try {
      const invoice = await this.nowpayments.createInvoice({
        priceUsd,
        orderId: payment.orderId,
        description: firstMonth ? 'Svinooh.Pro — first month' : 'Svinooh.Pro — 1 month',
        payCurrency: lock,
        ipnUrl: config.publicApiUrl
          ? `${config.publicApiUrl}/api/billing/webhook/nowpayments`
          : null,
        successUrl: `${config.webUrl}/pro?paid=1`,
        cancelUrl: `${config.webUrl}/pro`,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { invoiceId: invoice.invoiceId, invoiceUrl: invoice.url, status: 'waiting' },
      });
      return { url: invoice.url };
    } catch (error) {
      // The row stays, marked: a checkout that died at the gateway is a fact
      // worth seeing next to the ones that came back
      await this.prisma.payment
        .update({ where: { id: payment.id }, data: { status: 'failed' } })
        .catch(() => undefined);
      this.logger.error(`checkout for ${userId} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not reach the payment provider. Try again in a minute.',
      );
    }
  }

  /**
   * What an earlier checkout under this key already answered, while that
   * answer still holds.
   *
   * An invoice that can still be paid is the answer, again. An attempt with no
   * invoice yet is another request still at the gateway: a 409 to try again
   * shortly, never a second invoice. Anything else is over — paid, expired,
   * failed at the gateway — and lets go of the key, so the same page can buy
   * another month, or try again after a failure, under it.
   */
  private async answeredBefore(userId: string, key: string): Promise<CheckoutDto | null> {
    const earlier = await this.prisma.payment.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    });
    if (earlier === null) return null;
    if (earlier.invoiceUrl !== null && OPEN.has(earlier.status)) return { url: earlier.invoiceUrl };
    const young = Date.now() - earlier.createdAt.getTime() < IN_FLIGHT_MS;
    if (earlier.invoiceUrl === null && earlier.status !== 'failed' && young) throw inProgress();
    await this.prisma.payment.update({ where: { id: earlier.id }, data: { idempotencyKey: null } });
    return null;
  }

  /**
   * NOWPayments calling back. Its authentication is the HMAC over the
   * alphabetically-sorted body — a bad or missing signature is a 401 and
   * nothing read.
   */
  async nowpaymentsWebhook(
    body: Record<string, unknown>,
    signature: string | undefined,
  ): Promise<void> {
    if (!this.nowpayments.verify(body, signature)) {
      throw new UnauthorizedException('Bad signature');
    }
    const orderId = typeof body.order_id === 'string' ? body.order_id : null;
    const status = paymentStatusOf(
      typeof body.payment_status === 'string' ? body.payment_status : '',
    );
    if (!orderId || !status) {
      this.logger.warn(
        `nowpayments webhook ignored: order=${orderId ?? '?'} status=${String(body.payment_status)}`,
      );
      return;
    }
    await this.applyObservation(orderId, {
      status,
      providerPaymentId:
        body.payment_id === undefined || body.payment_id === null ? null : String(body.payment_id),
      payCurrency: typeof body.pay_currency === 'string' ? body.pay_currency : null,
      paidAmount: typeof body.actually_paid === 'number' ? body.actually_paid : null,
      raw: body as Prisma.InputJsonValue,
    });
  }

  /**
   * One verified webhook, applied. Statuses may arrive out of order and more
   * than once; two rules keep the books straight: nothing talks a finished
   * payment back down, and whoever moves the row to `paid` — exactly one
   * transaction can — is the one that extends the subscription.
   */
  private async applyObservation(
    orderId: string,
    observed: {
      status: string;
      providerPaymentId: string | null;
      payCurrency: string | null;
      paidAmount: number | null;
      raw: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) {
      // Signed with our secret but naming an order we never opened — a bug or
      // another environment's traffic, and either way worth a loud line
      this.logger.warn(`nowpayments webhook for unknown order ${orderId}`);
      return;
    }

    const fields = {
      status: observed.status,
      providerPaymentId: observed.providerPaymentId ?? payment.providerPaymentId,
      payCurrency: observed.payCurrency ?? payment.payCurrency,
      paidAmount: observed.paidAmount ?? payment.paidAmount,
      raw: observed.raw,
    };

    if (observed.status !== 'paid') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, NOT: { status: 'paid' } },
        data: fields,
      });
      if (observed.status === 'underpaid') {
        this.logger.warn(
          `payment ${payment.id} underpaid: ${String(observed.paidAmount)} ${observed.payCurrency ?? ''} against ${payment.priceUsd} usd — no month granted, resolve by hand`,
        );
      }
      return;
    }

    const paidUntil = await this.extendFor(payment, fields);
    if (paidUntil !== null) {
      this.logger.log(`payment ${payment.id} finished: Pro until ${paidUntil.toISOString()}`);
      await this.sayPaid(payment.userId, paidUntil);
    }
  }

  /** The idempotency line — a replayed webhook finds the row already paid */
  private async extendFor(
    payment: Payment,
    fields: Prisma.PaymentUpdateManyMutationInput,
  ): Promise<Date | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, NOT: { status: 'paid' } },
        data: { ...fields, paidAt: new Date() },
      });
      if (claimed.count === 0) return null;
      const sub = await tx.subscription.findUnique({ where: { userId: payment.userId } });
      const now = new Date();
      // Renewing early stacks on the paid-until date; renewing late starts now
      const base = sub !== null && sub.paidUntil > now ? sub.paidUntil : now;
      const next = addMonths(base, payment.months);
      await tx.subscription.upsert({
        where: { userId: payment.userId },
        create: { userId: payment.userId, paidUntil: next },
        update: { paidUntil: next },
      });
      return next;
    });
  }

  /** The thank-you in Telegram, where the reminders will also arrive */
  private async sayPaid(userId: string, paidUntil: Date): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, alertChatId: true },
    });
    const chat = user?.telegramId ?? user?.alertChatId ?? null;
    if (chat === null) return;
    const notice: BillingNotice = {
      telegramId: chat.toString(),
      kind: 'paid',
      priceUsd: setting('billing.proPriceUsd'),
      wasPriceUsd: setting('billing.proWasPriceUsd'),
      firstMonthUsd: setting('billing.firstMonthUsd'),
      paidUntil: paidUntil.toISOString(),
    };
    await this.queue.publish(BILLING_QUEUE, notice);
  }

  /** The welcome price is for accounts that have never finished a payment */
  private async firstMonthEligible(userId: string): Promise<boolean> {
    const paid = await this.prisma.payment.count({ where: { userId, status: 'paid' } });
    return paid === 0;
  }
}
