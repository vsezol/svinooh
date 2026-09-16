import { PrismaClient } from '@prisma/client';
import type { AlertEvent, WalletStateEvent } from '@svinooh/shared';
import { ALERTS_QUEUE, BILLING_QUEUE, type QueueService } from '@svinooh/common';
import { decide, type Remembered, type Settings } from './decide';
import type { Trial } from './trial';

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
 * Postgres refuses NUL in text outright (22021), and the alert states are
 * written in one transaction per wallet — so a single key carrying one, from a
 * scam token's padded bytes32 symbol, vetoes the state of every position
 * beside it, every scan. The producer cleans its keys too, but this consumer
 * outlives any one producer version and takes events from all of them; what it
 * is about to write is its own to guarantee.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Escaped for a log line: the whole point is to SEE the invisible byte */
const escaped = (s: string): string => JSON.stringify(s);

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
    private readonly queues: QueueService,
    private readonly trial: Trial,
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
    // The keys are about to become database rows, so they are cleaned at this
    // door whatever the producer did — and a cleaning that changed anything is
    // said out loud with the bytes made visible, because it means some producer
    // is still emitting them and the log is what will name it.
    const positions = event.positions.map((position) => {
      const key = position.key.replace(CONTROL, '');
      if (key !== position.key) {
        console.warn(
          `control bytes in position key from ${event.chain} ${event.address}: ${escaped(position.key)}`,
        );
      }
      return key === position.key ? position : { ...position, key };
    });

    const memberships = await this.prisma.portfolioWallet.findMany({
      where: { walletId: event.walletId },
      select: {
        id: true,
        label: true,
        alerts: true,
        portfolio: {
          select: {
            slug: true,
            owner: {
              select: {
                user: {
                  select: {
                    id: true,
                    telegramId: true,
                    alertChatId: true,
                    subscription: { select: { paidUntil: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const membership of memberships) {
      // A portfolio nobody owns has nobody to tell, and an owner with no chat
      // to reach has nowhere to be told. The chat is the identity's own when
      // the account IS Telegram, and the connected delivery chat when it is
      // not (an X account, say). Either way the state is still worth
      // remembering, so the day a chat appears they are baselined rather than
      // told about a year of crossings at once.
      const who = membership.portfolio.owner?.user;
      const telegramId = who?.telegramId ?? who?.alertChatId ?? null;

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
      const { items, next } = decide(positions, settings, previous, event.tron ?? null);

      // Said before it is written down. If this throws, nothing is remembered
      // and the next scan decides the same thing again — an alert arriving
      // twice is a nuisance, and one that never arrives because we recorded
      // having sent it is the failure that matters.
      //
      // The trial stands between deciding and saying: the first N messages go
      // out and are counted, the one after that becomes the pitch (at most
      // once a day), and past that the owner hears nothing until they pay.
      // The state below is still remembered either way, exactly as it is for
      // an owner with no chat: the day they upgrade they are baselined, not
      // buried under a backlog of old crossings.
      if (items.length && telegramId !== null && who !== undefined) {
        const call = await this.trial.judge(who.id, who.subscription?.paidUntil ?? null);
        if (call.verdict === 'send') {
          const alert: AlertEvent = {
            telegramId: telegramId.toString(),
            portfolioSlug: membership.portfolio.slug,
            walletLabel: membership.label,
            walletAddress: event.address,
            chain: event.chain,
            items,
          };
          await this.queues.publish(ALERTS_QUEUE, alert);
          if (call.count) await this.trial.counted(who.id);
        } else if (call.verdict === 'upsell') {
          if (await this.queues.publish(BILLING_QUEUE, this.trial.notice(telegramId.toString()))) {
            await this.trial.pitched(who.id);
          }
        }
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
