import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { Portfolio, User } from '@prisma/client';
import type {
  AuthConfigDto,
  AuthResponseDto,
  MeDto,
  TelegramAuthPayload,
  TelegramPollDto,
  TelegramStartDto,
} from '@svinooh/shared';
import { randomSlug } from '../common/util';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { verifyTelegramLogin } from './telegram';
import { TelegramBotService } from './telegram-bot.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly bot: TelegramBotService,
  ) {}

  getConfig(): AuthConfigDto {
    return {
      botUsername: config.botUsername,
      // bot_id — the numeric token prefix (public), needed by the frontend for
      // Telegram.Login.auth with a custom button
      botId: config.botToken ? config.botToken.split(':')[0] : null,
      devMode: config.devMode,
      syncIntervalMin: config.syncIntervalMin,
    };
  }

  async telegramLogin(payload: TelegramAuthPayload): Promise<AuthResponseDto> {
    if (!config.botToken) {
      throw new ServiceUnavailableException('Telegram sign-in is not configured');
    }
    const problem = verifyTelegramLogin(payload, config.botToken);
    if (problem) throw new UnauthorizedException(`Telegram data check failed: ${problem}`);

    return this.finishLogin(
      await this.upsertTelegram({
        id: payload.id,
        firstName: payload.first_name,
        lastName: payload.last_name,
        username: payload.username,
        photoUrl: payload.photo_url,
      }),
    );
  }

  /** Start bot sign-in — a link that opens the Telegram app */
  telegramStart(): TelegramStartDto {
    if (!config.botToken || !config.botUsername) {
      throw new ServiceUnavailableException('Telegram sign-in is not configured');
    }
    const token = randomBytes(24).toString('base64url');
    this.bot.create(token);
    return {
      token,
      botUsername: config.botUsername,
      deepLink: `https://t.me/${config.botUsername}?start=${token}`,
    };
  }

  /** Poll the bot sign-in status */
  async telegramPoll(token: string): Promise<TelegramPollDto> {
    const entry = this.bot.get(token);
    if (!entry) throw new UnauthorizedException('Sign-in session expired, start again');
    if (entry.status !== 'authenticated' || !entry.user) return { pending: true };
    this.bot.consume(token); // one-time use
    return this.finishLogin(
      await this.upsertTelegram({
        id: entry.user.id,
        firstName: entry.user.first_name,
        lastName: entry.user.last_name,
        username: entry.user.username,
      }),
    );
  }

  private upsertTelegram(p: {
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

  /** Local development without the bot: enabled via AUTH_DEV_MODE=true */
  async devLogin(nameRaw: string): Promise<AuthResponseDto> {
    if (!config.devMode) throw new ForbiddenException('Dev sign-in is disabled');
    const name = String(nameRaw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32);
    if (name.length < 2) {
      throw new BadRequestException('Name: latin letters/digits/dash, at least 2 chars');
    }
    const user = await this.prisma.user.upsert({
      where: { devKey: name },
      create: { devKey: name, username: name, firstName: name },
      update: {},
    });
    return this.finishLogin(user);
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const portfolio = await this.ensurePortfolio(user);
    return this.toMe(user, portfolio.slug);
  }

  private async finishLogin(user: User): Promise<AuthResponseDto> {
    const portfolio = await this.ensurePortfolio(user);
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, me: this.toMe(user, portfolio.slug) };
  }

  /** The portfolio is created on first sign-in. Just one for now; the schema allows several. */
  private async ensurePortfolio(user: User): Promise<Portfolio> {
    const existing = await this.prisma.portfolio.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    const display = user.username ? `@${user.username}` : user.firstName || 'no name';
    return this.prisma.portfolio.create({
      data: { userId: user.id, slug: randomSlug(), name: `${display}'s portfolio` },
    });
  }

  private toMe(user: User, portfolioSlug: string): MeDto {
    return {
      id: user.id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Anonymous',
      username: user.username,
      photoUrl: user.photoUrl,
      portfolioSlug,
    };
  }
}
