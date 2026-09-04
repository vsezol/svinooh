import { HttpException, Injectable } from '@nestjs/common';
import { option, setting } from '@svinooh/common';
import type { ProFeature, ProLimitsDto, ProOfferDto } from '@svinooh/shared';
import { PrismaService } from '@svinooh/db';
import { buildOffer, paywallBody, utcDay } from './premium';

/**
 * The gates. Everything that asks "may this account do one more of X" asks
 * here, and the answer is either silence or a 402 whose body carries the whole
 * offer — see paywallBody.
 *
 * Two rules run through every gate:
 *
 * - `billing.enforce` off means every gate stands open while the meters still
 *   run, so the day it is flipped on the counters are already honest. It ships
 *   off, because a 402 is only as good as the paywall the web draws for it.
 * - Pro is `paidUntil > now`, read from the database on every check the same
 *   way AdminGuard re-reads isAdmin: a lapsed subscription must stop working
 *   the minute it lapses, not when a token expires.
 */
@Injectable()
export class PremiumService {
  constructor(private readonly prisma: PrismaService) {}

  enforced(): boolean {
    return option('billing.enforce') === 'on';
  }

  limits(): ProLimitsDto {
    return {
      freeAlerts: setting('billing.freeAlerts'),
      freePortfolios: setting('billing.freePortfolios'),
      freeWalletsPerPortfolio: setting('billing.freeWalletsPerPortfolio'),
      freeHistoryDays: setting('billing.freeHistoryDays'),
      freeAiPerDay: setting('billing.freeAiPerDay'),
    };
  }

  offer(): ProOfferDto {
    return buildOffer({
      priceUsd: setting('billing.proPriceUsd'),
      wasPriceUsd: setting('billing.proWasPriceUsd'),
      firstMonthUsd: setting('billing.firstMonthUsd'),
      limits: this.limits(),
    });
  }

  async isPro(userId: string | null): Promise<boolean> {
    if (userId === null) return false;
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
      select: { paidUntil: true },
    });
    return sub !== null && sub.paidUntil.getTime() > Date.now();
  }

  paywall(feature: ProFeature): HttpException {
    return new HttpException(paywallBody(feature, this.offer()), 402);
  }

  /**
   * One more OWNED portfolio — the gate on both creating and claiming one.
   *
   * The claim path passes `ignoreEmpty`: claiming garbage-collects the
   * account's empty portfolios (see PortfolioService.claim), so the shell that
   * sign-in handed out must not be the thing that blocks somebody's first real
   * portfolio. Creation counts everything — empty portfolios are exactly what
   * farming the limit would look like.
   */
  async assertAnotherPortfolio(userId: string, opts?: { ignoreEmpty: boolean }): Promise<void> {
    if (!this.enforced() || (await this.isPro(userId))) return;
    const owned = await this.prisma.portfolioOwner.count({
      where: opts?.ignoreEmpty
        ? { userId, portfolio: { wallets: { some: {} } } }
        : { userId },
    });
    if (owned >= setting('billing.freePortfolios')) throw this.paywall('portfolios');
  }

  /**
   * The wallet cap on portfolios this actor adds to, or null for no cap.
   * Answered for the actor rather than the portfolio, because an anonymous
   * portfolio has no plan of its own — the person at the wheel does.
   */
  async walletCap(userId: string | null): Promise<number | null> {
    if (!this.enforced() || (await this.isPro(userId))) return null;
    return setting('billing.freeWalletsPerPortfolio');
  }

  /** How far back charts reach for this viewer, or null for the whole history */
  async historyDays(userId: string | null): Promise<number | null> {
    if (!this.enforced() || (await this.isPro(userId))) return null;
    return setting('billing.freeHistoryDays');
  }

  /**
   * Spend one agent request or answer with the pitch. Nothing calls this yet —
   * the agent is not shipped — but the meter and the gate are the contract it
   * will be built against.
   *
   * Two requests racing the read can both pass a quota of one; for a
   * per-day nicety that costs a duplicate answer, not money, and is not worth
   * a lock.
   */
  async consumeAi(userId: string): Promise<void> {
    if (!this.enforced() || (await this.isPro(userId))) return;
    const limit = setting('billing.freeAiPerDay');
    const day = utcDay(new Date());
    const usage = await this.prisma.featureUsage.findUnique({ where: { userId } });
    const used = usage?.aiDay === day ? usage.aiUsed : 0;
    if (used >= limit) throw this.paywall('ai');
    await this.prisma.featureUsage.upsert({
      where: { userId },
      create: { userId, aiDay: day, aiUsed: 1 },
      update: { aiDay: day, aiUsed: used + 1 },
    });
  }
}
