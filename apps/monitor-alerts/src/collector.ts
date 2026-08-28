import { PrismaClient } from '@prisma/client';
import type { AlertEvent, WalletStateEvent } from '@svinooh/shared';
import { ALERTS_QUEUE, type RabbitService } from '@svinooh/common';
import { decide, type Remembered, type Settings } from './decide';

/**
 * What a wallet is watched for when nobody has said otherwise. The same list
 * the API answers with and the same list the settings page shows — see
 * `apps/api/src/portfolio/portfolio.service.ts` and `web/src/lib/alerts.ts`.
 */
const DEFAULTS: Settings = { rangeAlerts: true, healthFactorBelow: 1.1, borrowApyAbove: 12 };

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

  async handle(event: WalletStateEvent): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: event.walletId },
      select: {
        label: true,
        alerts: true,
        portfolio: {
          select: { slug: true, owner: { select: { user: { select: { telegramId: true } } } } },
        },
      },
    });

    // A portfolio nobody owns has nobody to tell, and an owner who has never
    // opened Telegram has no chat to tell them in. Either way the state is
    // still worth remembering, so the day they do sign in they are baselined
    // rather than told about a year of crossings at once.
    const telegramId = wallet?.portfolio.owner?.user.telegramId ?? null;

    const settings: Settings = wallet?.alerts
      ? {
          rangeAlerts: wallet.alerts.rangeAlerts,
          healthFactorBelow: wallet.alerts.healthFactorBelow,
          borrowApyAbove: wallet.alerts.borrowApyAbove,
        }
      : DEFAULTS;

    const previous = await this.remembered(event.walletId);
    const { items, next } = decide(event.positions, settings, previous);

    // Said before it is written down. If this throws, nothing is remembered and
    // the next scan decides the same thing again — an alert arriving twice is a
    // nuisance, and one that never arrives because we recorded having sent it
    // is the failure that matters.
    if (items.length && telegramId !== null && wallet) {
      const alert: AlertEvent = {
        telegramId: telegramId.toString(),
        portfolioSlug: wallet.portfolio.slug,
        walletLabel: wallet.label,
        walletAddress: event.address,
        chain: event.chain,
        items,
      };
      await this.rabbit.publish(ALERTS_QUEUE, alert);
    }

    await this.remember(event.walletId, next);
  }

  private async remembered(walletId: string): Promise<Map<string, Remembered>> {
    const rows = await this.prisma.walletAlertState.findMany({ where: { walletId } });
    return new Map(
      rows.map((row) => [
        row.positionKey,
        { inRange: row.inRange, healthBreached: row.healthBreached, borrowBreached: row.borrowBreached },
      ]),
    );
  }

  /**
   * Positions that were not in this scan keep their rows. A source that could
   * not be reached looks exactly like a position that closed, and forgetting on
   * that basis is how a protocol coming back announces that everything has
   * changed. A stale row costs a few bytes; the wallet going away takes it.
   */
  private async remember(walletId: string, next: Map<string, Remembered>): Promise<void> {
    await this.prisma.$transaction(
      [...next].map(([positionKey, state]) =>
        this.prisma.walletAlertState.upsert({
          where: { walletId_positionKey: { walletId, positionKey } },
          create: { walletId, positionKey, ...state },
          update: state,
        }),
      ),
    );
  }
}
