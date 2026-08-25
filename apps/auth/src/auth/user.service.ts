import { Injectable } from '@nestjs/common';
import type { Portfolio, User } from '@prisma/client';
import { PrismaService } from '@svinooh/db';
import { randomSlug } from '../common/util';

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
   * The portfolio is created on first sign-in. Just one for now; the schema
   * allows several.
   *
   * It is created PRIVATE (`PortfolioOwner.isPublic` defaults to false) and with
   * a name that says nothing about who owns it — the name is public whenever the
   * portfolio is, so putting a handle in it would leak identity the moment the
   * owner publishes.
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
        name: 'My portfolio',
        owner: { create: { userId: user.id } },
      },
    });
  }
}
