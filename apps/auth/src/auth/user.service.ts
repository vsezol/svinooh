import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Portfolio, User } from '@prisma/client';
import { PrismaService } from '@svinooh/db';
import { randomSlug } from '../common/util';

/**
 * How long a sign-in link from the bot stays good. An hour covers the case the
 * link exists for — made on the desktop, opened on the phone a moment later —
 * without leaving a working credential sitting in a chat for the rest of the
 * day. Past that the site says so and offers a new one, which is a press in the
 * bot away.
 */
const LINK_TTL_MS = 60 * 60_000;

/**
 * Owns the User record and its portfolio. Split out of AuthService because the
 * bot needs it too: to put a link to the user's own portfolio in its "return to
 * the site" button, it has to resolve the account the moment the login is
 * confirmed — before the site has polled for it. Both callers going through
 * here keeps a single definition of "sign in and make sure a portfolio exists".
 */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  upsertTelegram(p: {
    id: number;
    firstName?: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
  }): Promise<User> {
    const telegramId = BigInt(p.id);
    const profile = {
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      username: p.username ?? null,
      // the bot doesn't send a photo — don't overwrite the one already saved from the web widget
      ...(p.photoUrl !== undefined ? { photoUrl: p.photoUrl ?? null } : {}),
    };
    return this.prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...profile },
      update: profile,
    });
  }

  /**
   * The X account is its own identity, exactly as a Telegram account is:
   * signing in with X finds or makes the user that IS that X account, and
   * never reaches for a Telegram user to attach to. X has one display name
   * where Telegram has two, so it lands in firstName whole.
   */
  upsertX(p: { id: string; name?: string; username?: string; photoUrl?: string }): Promise<User> {
    const profile = {
      firstName: p.name ?? null,
      lastName: null,
      username: p.username ?? null,
      photoUrl: p.photoUrl ?? null,
    };
    return this.prisma.user.upsert({
      where: { xId: p.id },
      create: { xId: p.id, ...profile },
      update: profile,
    });
  }

  /**
   * Point this user's alerts at a Telegram chat. A delivery address and only
   * that: the chat's own Telegram account, if it ever signs in, is a different
   * user — nothing here reads or writes telegramId.
   */
  bindAlertChat(userId: string, chatId: number): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { alertChatId: BigInt(chatId) },
    });
  }

  unbindAlertChat(userId: string): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { alertChatId: null } });
  }

  /**
   * The portfolio is created on first sign-in. Just one for now; the schema
   * allows several.
   *
   * It is created PRIVATE (`PortfolioOwner.isPublic` defaults to false) and
   * WITHOUT a name: the slug identifies it. An auto-generated name is public the
   * moment the owner publishes, so it must never be derived from who they are —
   * and a placeholder like "My portfolio" reads as nonsense to everyone else.
   */
  async ensurePortfolio(user: User): Promise<Portfolio> {
    const existing = await this.prisma.portfolioOwner.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { portfolio: true },
    });
    if (existing) return existing.portfolio;
    return this.prisma.portfolio.create({
      data: {
        slug: randomSlug(),
        owner: { create: { userId: user.id } },
      },
    });
  }

  /**
   * Mint a link that signs its opener in. The bot puts it in the chat, so it is
   * a bearer credential sitting in a place that already grants this account:
   * whoever can read the chat can press Start and get a fresh one anyway.
   *
   * Issuing supersedes the user's earlier links, so an old message — forwarded,
   * screenshotted, left on a shared screen — stops working the moment they sign
   * in again. Expired rows from every user are swept on the way past.
   */
  async issueLoginLink(userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.loginLink.deleteMany({
        where: { OR: [{ userId }, { expiresAt: { lt: now } }] },
      }),
      this.prisma.loginLink.create({
        data: { token, userId, expiresAt: new Date(now.getTime() + LINK_TTL_MS) },
      }),
    ]);
    return token;
  }
}
