import { Injectable } from '@nestjs/common';
import { PrismaService } from '@svinooh/db';

/** Who pressed Start, once the bot has said so */
export interface TelegramIdentity {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

const TTL_MS = 5 * 60_000;

/**
 * The sign-ins the site has started and is still waiting on.
 *
 * This used to be a `Map` inside the bot, which worked while the bot and the
 * gateway were the same process. They are not any more, and they cannot be:
 * Telegram allows one long-poll consumer per bot token, so the service that
 * hears "Start" is not the service the browser tab is asking. The row is the
 * only thing the two share.
 *
 * Five minutes and one use. It holds a Telegram id and a name for exactly as
 * long as it takes the tab to collect them, and the row is gone the moment it
 * is traded for a session.
 */
@Injectable()
export class TelegramLoginService {
  constructor(private readonly prisma: PrismaService) {}

  /** A new sign-in, waiting for the bot to say who it was */
  async create(token: string): Promise<void> {
    await this.prisma.telegramLogin.create({
      data: { token, expiresAt: new Date(Date.now() + TTL_MS) },
    });
    // Cheap enough to do here, and it means nothing has to sweep the table on a
    // timer: every new sign-in clears the ones that were never finished
    await this.prisma.telegramLogin
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);
  }

  /**
   * The bot's answer. Silent when the token is unknown or expired: somebody who
   * opened the bot from an old link still gets their way in — see the reply the
   * bot sends — and only the tab that is waiting misses out, which is the tab
   * that has already given up.
   */
  async authenticate(token: string, who: TelegramIdentity): Promise<void> {
    await this.prisma.telegramLogin.updateMany({
      where: { token, expiresAt: { gt: new Date() } },
      data: {
        telegramId: BigInt(who.id),
        firstName: who.first_name ?? null,
        lastName: who.last_name ?? null,
        username: who.username ?? null,
      },
    });
  }

  /** Still waiting, or gone */
  async pending(token: string): Promise<boolean> {
    const row = await this.prisma.telegramLogin.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
      select: { telegramId: true },
    });
    return row !== null && row.telegramId === null;
  }

  /**
   * Takes the answer, once. Returns null while it is still waiting or when the
   * sign-in has expired — the caller tells those two apart with `pending`,
   * because "not yet" and "too late" need different things said to them.
   */
  async take(token: string): Promise<TelegramIdentity | null> {
    const row = await this.prisma.telegramLogin.findFirst({
      where: { token, expiresAt: { gt: new Date() }, telegramId: { not: null } },
    });
    if (!row || row.telegramId === null) return null;
    await this.prisma.telegramLogin.deleteMany({ where: { token } });
    return {
      id: Number(row.telegramId),
      first_name: row.firstName ?? undefined,
      last_name: row.lastName ?? undefined,
      username: row.username ?? undefined,
    };
  }
}
