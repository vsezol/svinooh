import { PrismaClient } from '@prisma/client';
import type { AlertEvent, WalletStateEvent } from '@svinooh/shared';
import { ALERTS_QUEUE, type RabbitService } from '@svinooh/common';
import { decide, type Remembered, type Settings } from './decide';

/**
 * What a wallet is watched for when nobody has said otherwise. The same list
 * the API answers with and the same list the settings page shows — see
 * `apps/api/src/portfolio/portfolio.service.ts` and `web/src/lib/alerts.ts`.
 */
const DEFAULTS: Settings = {
  rangeAlerts: true,
  healthFactorBelow: 1.1,
  borrowApyAbove: 12,
  tronReclaimAlerts: true,
  tronDelegateAlerts: true,
};

/**
 * Turns "here is what this wallet looks like" into "here is what its owner
 * asked to be told".
 *
 * The whole service is this function. It knows who owns the wallet, what they
 * asked for, and what was true last time; it decides what changed and says so.
 * It does not format anything — the bot does that — and it does not scan
 * anything, because by the time it hears about a wallet the scanning is done.
 */
export class Collector {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rabbit: RabbitService,
  ) {}

  /**
   * One scan of one address, told to everybody watching it.
   *
   * A scan says what an address looks like; it does not know who cares. Two
   * people can hold the same address in different portfolios, with different
   * thresholds and different memories of what was already true — so the same
   * reading can be news to one of them and nothing to the other, and each is
   * judged separately against their own settings and their own state.
   */
  async handle(event: WalletStateEvent): Promise<void> {
    const memberships = await this.prisma.portfolioWallet.findMany({
      where: { walletId: event.walletId },
      select: {
        id: true,
        label: true,
        alerts: true,
        portfolio: {
          select: { slug: true, owner: { select: { user: { select: { telegramId: true } } } } },
        },
      },
    });

    for (const membership of memberships) {
      // A portfolio nobody owns has nobody to tell, and an owner who has never
      // opened Telegram has no chat to tell them in. Either way the state is
      // still worth remembering, so the day they do sign in they are baselined
      // rather than told about a year of crossings at once.
      const telegramId = membership.portfolio.owner?.user.telegramId ?? null;

      const settings: Settings = membership.alerts
        ? {
            rangeAlerts: membership.alerts.rangeAlerts,
            healthFactorBelow: membership.alerts.healthFactorBelow,
            borrowApyAbove: membership.alerts.borrowApyAbove,
            tronReclaimAlerts: membership.alerts.tronReclaimAlerts,
            tronDelegateAlerts: membership.alerts.tronDelegateAlerts,
          }
        : DEFAULTS;

      const previous = await this.remembered(membership.id);
      // `?? null` rather than trusted: during a deploy the queue still holds
      // states published by a wallet service that predates the field
      const { items, next } = decide(event.positions, settings, previous, event.tron ?? null);

      // Said before it is written down. If this throws, nothing is remembered
      // and the next scan decides the same thing again — an alert arriving
      // twice is a nuisance, and one that never arrives because we recorded
      // having sent it is the failure that matters.
      if (items.length && telegramId !== null) {
        const alert: AlertEvent = {
          telegramId: telegramId.toString(),
          portfolioSlug: membership.portfolio.slug,
          walletLabel: membership.label,
          walletAddress: event.address,
          chain: event.chain,
          items,
        };
        await this.rabbit.publish(ALERTS_QUEUE, alert);
      }

      await this.remember(membership.id, next);
    }
  }

  private async remembered(portfolioWalletId: string): Promise<Map<string, Remembered>> {
    const rows = await this.prisma.walletAlertState.findMany({ where: { portfolioWalletId } });
    return new Map(
      rows.map((row) => [
        row.positionKey,
        {
          inRange: row.inRange,
          healthBreached: row.healthBreached,
          borrowBreached: row.borrowBreached,
          reclaimArmed: row.reclaimArmed,
          delegateArmed: row.delegateArmed,
        },
      ]),
    );
  }

  /**
   * Positions that were not in this scan keep their rows. A source that could
   * not be reached looks exactly like a position that closed, and forgetting on
   * that basis is how a protocol coming back announces that everything has
   * changed. A stale row costs a few bytes; the membership going away takes it.
   */
  private async remember(portfolioWalletId: string, next: Map<string, Remembered>): Promise<void> {
    await this.prisma.$transaction(
      [...next].map(([positionKey, state]) =>
        this.prisma.walletAlertState.upsert({
          where: { portfolioWalletId_positionKey: { portfolioWalletId, positionKey } },
          create: { portfolioWalletId, positionKey, ...state },
          update: state,
        }),
      ),
    );
  }
}
