import { Injectable } from '@nestjs/common';
import { BILLING_QUEUE, RabbitService, setting } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { BillingNotice } from '@svinooh/shared';

/**
 * The stand-in for a charge on file: crypto cannot auto-debit anybody, so a
 * renewal is a person paying one more invoice, and this sweep is what asks
 * them to.
 *
 * Two messages, each once per paid period, both re-armed by the thing they ask
 * for — the same shape as Slowdown:
 *
 * - "Pro ends in N days", once the period enters its final stretch. Sent when
 *   no reminder has gone out since this period entered it: `remindedAt` is
 *   compared against `paidUntil - REMIND_DAYS`, so a renewal that moves
 *   paidUntil forward re-arms the reminder with no second write.
 * - "Pro has ended", once per expiry: `expiredNoticeAt < paidUntil`, re-armed
 *   the same way. Only within a week of the expiry — past that the silence is
 *   an answer, and nagging a lapsed account forever is how a bot gets blocked.
 */
const REMIND_DAYS = 3;
const EXPIRED_NAG_DAYS = 7;
const DAY_MS = 86_400e3;

/** Both due-decisions as pure functions, for the check script */
export function reminderDue(remindedAt: Date | null, paidUntil: Date, now: Date): boolean {
  if (paidUntil <= now || paidUntil.getTime() - now.getTime() > REMIND_DAYS * DAY_MS) return false;
  return remindedAt === null || remindedAt.getTime() < paidUntil.getTime() - REMIND_DAYS * DAY_MS;
}

export function expiredNoticeDue(
  expiredNoticeAt: Date | null,
  paidUntil: Date,
  now: Date,
): boolean {
  if (paidUntil > now || now.getTime() - paidUntil.getTime() > EXPIRED_NAG_DAYS * DAY_MS)
    return false;
  return expiredNoticeAt === null || expiredNoticeAt < paidUntil;
}

@Injectable()
export class Renewals {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
  ) {}

  async sweep(now = new Date()): Promise<number> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        paidUntil: {
          gt: new Date(now.getTime() - EXPIRED_NAG_DAYS * DAY_MS),
          lt: new Date(now.getTime() + REMIND_DAYS * DAY_MS),
        },
        // Somebody to tell, who has told us where
        user: { OR: [{ telegramId: { not: null } }, { alertChatId: { not: null } }] },
      },
      include: { user: { select: { telegramId: true, alertChatId: true } } },
    });

    let sent = 0;
    for (const sub of subs) {
      const chat = (sub.user.telegramId ?? sub.user.alertChatId) as bigint;
      const prices = {
        priceUsd: setting('billing.proPriceUsd'),
        wasPriceUsd: setting('billing.proWasPriceUsd'),
        firstMonthUsd: setting('billing.firstMonthUsd'),
      };

      if (reminderDue(sub.remindedAt, sub.paidUntil, now)) {
        const notice: BillingNotice = {
          telegramId: chat.toString(),
          kind: 'expiring',
          ...prices,
          paidUntil: sub.paidUntil.toISOString(),
          daysLeft: Math.max(1, Math.ceil((sub.paidUntil.getTime() - now.getTime()) / DAY_MS)),
        };
        // Said before it is written down, the same way alerts are
        if (!(await this.rabbit.publish(BILLING_QUEUE, notice))) continue;
        await this.prisma.subscription.update({
          where: { userId: sub.userId },
          data: { remindedAt: now },
        });
        sent++;
      } else if (expiredNoticeDue(sub.expiredNoticeAt, sub.paidUntil, now)) {
        const notice: BillingNotice = {
          telegramId: chat.toString(),
          kind: 'expired',
          ...prices,
          limits: {
            freeAlerts: setting('billing.freeAlerts'),
            freePortfolios: setting('billing.freePortfolios'),
            freeWalletsPerPortfolio: setting('billing.freeWalletsPerPortfolio'),
            freeHistoryDays: setting('billing.freeHistoryDays'),
            freeAiPerDay: setting('billing.freeAiPerDay'),
          },
        };
        if (!(await this.rabbit.publish(BILLING_QUEUE, notice))) continue;
        await this.prisma.subscription.update({
          where: { userId: sub.userId },
          data: { expiredNoticeAt: now },
        });
        sent++;
      }
    }
    return sent;
  }
}
