import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';
import { BILLING_QUEUE, RabbitService, setting } from '@svinooh/common';
import type { BillingMeDto, BillingNotice, CheckoutDto } from '@svinooh/shared';
import { PrismaService } from '@svinooh/db';
import { randomSlug } from '../common/util';
import { config } from '../config';
import { CryptomusClient, cryptomusStatusOf, cryptomusWebhookValid } from './cryptomus.client';
import type { PaymentGateway } from './gateway';
import { NowPaymentsClient, paymentStatusOf } from './nowpayments.client';
import { addMonths, utcDay } from './premium';
import { PremiumService } from './premium.service';

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
 * Two gateways stand behind one seam (see gateway.ts); BILLING_PROVIDER picks
 * which one checkout uses, and both webhook routes stay mounted so a switch
 * never strands an invoice that was opened on the other side.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly premium: PremiumService,
    private readonly cryptomus: CryptomusClient,
    private readonly nowpayments: NowPaymentsClient,
    private readonly rabbit: RabbitService,
  ) {}

  private gateway(): PaymentGateway {
    return config.billingProvider === 'nowpayments' ? this.nowpayments : this.cryptomus;
  }

  async me(userId: string): Promise<BillingMeDto> {
    const now = new Date();
    const [sub, usage, portfolios, payments, firstMonthEligible] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId }, select: { paidUntil: true } }),
      this.prisma.featureUsage.findUnique({ where: { userId } }),
      this.prisma.portfolioOwner.count({ where: { userId } }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.firstMonthEligible(userId),
    ]);
    return {
      pro: sub !== null && sub.paidUntil > now,
      paidUntil: sub?.paidUntil.toISOString() ?? null,
      firstMonthEligible,
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
   */
  async checkout(userId: string): Promise<CheckoutDto> {
    const gateway = this.gateway();
    if (!gateway.enabled) {
      throw new ServiceUnavailableException('Payments are not configured yet');
    }
    const firstMonth = await this.firstMonthEligible(userId);
    const priceUsd = firstMonth
      ? setting('billing.firstMonthUsd')
      : setting('billing.proPriceUsd');

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        provider: gateway.name,
        orderId: `pro_${randomSlug(16)}`,
        months: 1,
        priceUsd,
      },
    });

    try {
      const invoice = await gateway.createInvoice({
        priceUsd,
        orderId: payment.orderId,
        description: firstMonth ? 'Svinooh.Pro — first month' : 'Svinooh.Pro — 1 month',
        ipnUrl: config.publicApiUrl
          ? `${config.publicApiUrl}/api/billing/webhook/${gateway.name}`
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
   * Cryptomus calling back. The signature rides inside the body; before the
   * one step that grants a month, the status is re-asked from their API —
   * an MD5-of-base64 signature is thin armor for money, and asking the source
   * costs one call.
   */
  async cryptomusWebhook(body: Record<string, unknown>): Promise<void> {
    if (!cryptomusWebhookValid(body, config.cryptomusApiKey)) {
      throw new UnauthorizedException('Bad signature');
    }
    const orderId = typeof body.order_id === 'string' ? body.order_id : null;
    let status = cryptomusStatusOf(typeof body.status === 'string' ? body.status : '');
    if (!orderId || !status) {
      this.logger.warn(
        `cryptomus webhook ignored: order=${orderId ?? '?'} status=${String(body.status)}`,
      );
      return;
    }
    if (status === 'paid') {
      const confirmed = await this.cryptomus.paymentStatus(orderId).catch((error: Error) => {
        this.logger.warn(`could not re-ask cryptomus about ${orderId}: ${error.message}`);
        return null;
      });
      // The webhook's word stands when the re-ask cannot answer — the
      // signature already vouched for it; the re-ask only gets to say no
      if (confirmed !== null && confirmed !== 'paid') {
        this.logger.warn(`cryptomus says ${orderId} is ${confirmed}, not paid — believing that`);
        status = confirmed;
      }
    }
    const paid = typeof body.payer_amount === 'string' ? Number(body.payer_amount) : NaN;
    await this.applyObservation('cryptomus', orderId, {
      status,
      providerPaymentId: typeof body.uuid === 'string' ? body.uuid : null,
      payCurrency: typeof body.payer_currency === 'string' ? body.payer_currency : null,
      paidAmount: Number.isFinite(paid) ? paid : null,
      raw: body as Prisma.InputJsonValue,
    });
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
    await this.applyObservation('nowpayments', orderId, {
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
    provider: string,
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
    if (!payment || payment.provider !== provider) {
      // Signed with our secret but naming an order we never opened — a bug or
      // another environment's traffic, and either way worth a loud line
      this.logger.warn(`${provider} webhook for unknown order ${orderId}`);
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
    await this.rabbit.publish(BILLING_QUEUE, notice);
  }

  /** The welcome price is for accounts that have never finished a payment */
  private async firstMonthEligible(userId: string): Promise<boolean> {
    const paid = await this.prisma.payment.count({ where: { userId, status: 'paid' } });
    return paid === 0;
  }
}
