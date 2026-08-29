import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type {
  AuthConfigDto,
  AuthResponseDto,
  MeDto,
  TelegramAuthPayload,
  TelegramPollDto,
  TelegramStartDto,
} from '@svinooh/shared';
import { config } from '../config';
import { PrismaService } from '@svinooh/db';
import { verifyTelegramLogin } from './telegram';
import { TelegramLoginService } from './telegram-login.service';
import { UserService } from './user.service';
import { setting } from '@svinooh/common';

/** How many times one sign-in link may be opened — see UserService.issueLoginLink */
const LINK_MAX_USES = 20;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly logins: TelegramLoginService,
    private readonly users: UserService,
  ) {}

  getConfig(): AuthConfigDto {
    return {
      botUsername: config.botUsername,
      // bot_id — the numeric token prefix (public), needed by the frontend for
      // Telegram.Login.auth with a custom button
      botId: config.botToken ? config.botToken.split(':')[0] : null,
      devMode: config.devMode,
      syncIntervalMin: setting('sync.activeIntervalMin'),
    };
  }

  async telegramLogin(payload: TelegramAuthPayload): Promise<AuthResponseDto> {
    if (!config.botToken) {
      throw new ServiceUnavailableException('Telegram sign-in is not configured');
    }
    const problem = verifyTelegramLogin(payload, config.botToken);
    if (problem) throw new UnauthorizedException(`Telegram data check failed: ${problem}`);

    return this.finishLogin(
      await this.users.upsertTelegram({
        id: payload.id,
        firstName: payload.first_name,
        lastName: payload.last_name,
        username: payload.username,
        photoUrl: payload.photo_url,
      }),
    );
  }

  /**
   * Start bot sign-in — a link that opens the Telegram app.
   *
   * The row is written before the link is handed out, and awaited. It used to
   * be a `Map` and writing to it took no time at all; a table does, and a link
   * given out first can be pressed before its row exists — the bot would then
   * find nothing to mark, say nothing about it, and leave the tab waiting on a
   * sign-in that had already happened.
   */
  async telegramStart(): Promise<TelegramStartDto> {
    if (!config.botToken || !config.botUsername) {
      throw new ServiceUnavailableException('Telegram sign-in is not configured');
    }
    const token = randomBytes(24).toString('base64url');
    await this.logins.create(token);
    return {
      token,
      botUsername: config.botUsername,
      deepLink: `https://t.me/${config.botUsername}?start=${token}`,
    };
  }

  /** Poll the bot sign-in status */
  async telegramPoll(token: string): Promise<TelegramPollDto> {
    const who = await this.logins.take(token);
    if (!who) {
      // Still waiting and already gone need different things said to them: one
      // is "keep holding", the other is "start again"
      if (await this.logins.pending(token)) return { pending: true };
      throw new UnauthorizedException('Sign-in session expired, start again');
    }
    return this.finishLogin(
      await this.users.upsertTelegram({
        id: who.id,
        firstName: who.first_name,
        lastName: who.last_name,
        username: who.username,
      }),
    );
  }

  /** Redeem one: the visitor gets the same session a normal sign-in would give */
  async loginWithLink(token: string): Promise<AuthResponseDto> {
    const expired = new UnauthorizedException(
      'This sign-in link has expired — open the bot and press Start for a new one',
    );
    if (!token) throw expired;
    const link = await this.prisma.loginLink.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!link || link.expiresAt < new Date() || link.uses >= LINK_MAX_USES) throw expired;
    await this.prisma.loginLink.update({ where: { token }, data: { uses: { increment: 1 } } });
    return this.finishLogin(link.user);
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
    const portfolio = await this.users.ensurePortfolio(user);
    return this.toMe(user, portfolio.slug);
  }

  private async finishLogin(user: User): Promise<AuthResponseDto> {
    const portfolio = await this.users.ensurePortfolio(user);
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, me: this.toMe(user, portfolio.slug) };
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
