import { Injectable } from '@nestjs/common';
import { NOTICES_QUEUE, RabbitService, setting } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { SlowedNotice } from '@svinooh/shared';

/**
 * Tells an owner their portfolio has gone quiet and is being checked less
 * often.
 *
 * The rate is decided by visits alone, which is simple and defensible but
 * invisible: somebody who reads their alerts in Telegram and never opens the
 * site would just find their warnings arriving more slowly, with nothing to
 * explain it. This is that explanation, and it doubles as the way back — the
 * thing that restores the rate is the thing the message asks them to do.
 *
 * Sent once per quiet spell. The condition "has not visited in a day" stays
 * true for as long as they stay away, so a naive check would send this every
 * time it ran, forever; instead we send only when there has been no notice
 * SINCE their last visit, which makes returning the thing that re-arms it.
 */
@Injectable()
export class Slowdown {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
  ) {}

  async sweep(now = new Date()): Promise<number> {
    const quietFor = setting('sync.staleAfterMin');
    const wentQuietAt = new Date(now.getTime() - quietFor * 60_000);

    const owners = await this.prisma.portfolioOwner.findMany({
      where: {
        // Somebody to tell, who has told us where — their own Telegram, or the
        // chat a non-Telegram identity connected for delivery
        user: { OR: [{ telegramId: { not: null } }, { alertChatId: { not: null } }] },
        portfolio: {
          // They HAVE visited, and it has since gone quiet. Never-visited is
          // not the same thing: a portfolio created a minute ago must not be
          // greeted with "you have not been here in a while".
          lastViewedAt: { not: null, lt: wentQuietAt },
          // Nothing to slow down if nothing is tracked
          wallets: { some: {} },
        },
      },
      select: {
        portfolioId: true,
        slowedNoticeAt: true,
        user: { select: { telegramId: true, alertChatId: true } },
        portfolio: { select: { slug: true, name: true, lastViewedAt: true } },
      },
    });

    let sent = 0;
    for (const owner of owners) {
      const lastViewedAt = owner.portfolio.lastViewedAt as Date;
      // Already said, and they have not been back since
      if (owner.slowedNoticeAt !== null && owner.slowedNoticeAt > lastViewedAt) continue;

      const notice: SlowedNotice = {
        telegramId: ((owner.user.telegramId ?? owner.user.alertChatId) as bigint).toString(),
        portfolioSlug: owner.portfolio.slug,
        portfolioName: owner.portfolio.name,
        quietForMin: Math.round((now.getTime() - lastViewedAt.getTime()) / 60_000),
        wasEveryMin: setting('sync.activeIntervalMin'),
        nowEveryMin: setting('sync.staleIntervalMin'),
      };

      // Said before it is written down, the same way alerts are: a notice that
      // arrives twice is a nuisance, one recorded as sent but never delivered
      // is silence that looks deliberate.
      if (!(await this.rabbit.publish(NOTICES_QUEUE, notice))) continue;
      await this.prisma.portfolioOwner.update({
        where: { portfolioId: owner.portfolioId },
        data: { slowedNoticeAt: now },
      });
      sent++;
    }
    return sent;
  }
}
