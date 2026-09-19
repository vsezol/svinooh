import { Injectable } from '@nestjs/common';
import { option, setting } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { BillingNotice } from '@svinooh/shared';

/**
 * The alert trial: the first N alert messages are free, and the message after
 * the last one is the pitch.
 *
 * The verdict is decided here and enforced in the collector, at the moment an
 * alert would otherwise be published. `count` is separate from the verdict on
 * purpose: the meter runs even while enforcement is off, so the day the wall
 * goes up the counters are already honest — and it never runs for Pro, whose
 * messages are not on a meter at all.
 */
export interface TrialCall {
  verdict: 'send' | 'upsell' | 'silent';
  count: boolean;
}

/** How often the pitch may replace an alert: a busy wallet is not a mailing list */
const UPSELL_EVERY_MS = 24 * 3600e3;

export function judgeAlert(input: {
  enforced: boolean;
  pro: boolean;
  alertsSent: number;
  freeAlerts: number;
  upsellAt: Date | null;
  now: Date;
}): TrialCall {
  if (input.pro) return { verdict: 'send', count: false };
  if (!input.enforced) return { verdict: 'send', count: true };
  if (input.alertsSent < input.freeAlerts) return { verdict: 'send', count: true };
  const quiet =
    input.upsellAt !== null && input.now.getTime() - input.upsellAt.getTime() < UPSELL_EVERY_MS;
  return quiet ? { verdict: 'silent', count: false } : { verdict: 'upsell', count: false };
}

@Injectable()
export class Trial {
  constructor(private readonly prisma: PrismaService) {}

  async judge(userId: string, paidUntil: Date | null, now = new Date()): Promise<TrialCall> {
    const pro = paidUntil !== null && paidUntil > now;
    const usage = pro
      ? null
      : await this.prisma.featureUsage.findUnique({
          where: { userId },
          select: { alertsSent: true, alertsUpsellAt: true },
        });
    return judgeAlert({
      enforced: option('billing.enforce') === 'on',
      pro,
      alertsSent: usage?.alertsSent ?? 0,
      freeAlerts: setting('billing.freeAlerts'),
      upsellAt: usage?.alertsUpsellAt ?? null,
      now,
    });
  }

  /** One more delivered message on the meter — after the publish, like remember() */
  async counted(userId: string): Promise<void> {
    await this.prisma.featureUsage.upsert({
      where: { userId },
      create: { userId, alertsSent: 1 },
      update: { alertsSent: { increment: 1 } },
    });
  }

  /** The pitch went out — quiet now until the throttle re-arms */
  async pitched(userId: string, now = new Date()): Promise<void> {
    await this.prisma.featureUsage.upsert({
      where: { userId },
      create: { userId, alertsUpsellAt: now },
      update: { alertsUpsellAt: now },
    });
  }

  /** What the pitch says, priced at the moment it was decided */
  notice(telegramId: string): BillingNotice {
    return {
      telegramId,
      kind: 'trial-ended',
      priceUsd: setting('billing.proPriceUsd'),
      wasPriceUsd: setting('billing.proWasPriceUsd'),
      firstMonthUsd: setting('billing.firstMonthUsd'),
      freeAlerts: setting('billing.freeAlerts'),
    };
  }
}
