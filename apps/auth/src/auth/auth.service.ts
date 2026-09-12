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
  OwnedPortfolioDto,
  TelegramAuthPayload,
  TelegramConnectPollDto,
  TelegramConnectStartDto,
  TelegramPollDto,
  TelegramStartDto,
  WalletChallengeDto,
} from '@svinooh/shared';
import { config } from '../config';
import { PrismaService } from '@svinooh/db';
import { verifyTelegramLogin } from './telegram';
import { TelegramLoginService } from './telegram-login.service';
import { UserService } from './user.service';
import { WalletLoginService } from './wallet-login.service';
import { XLoginService } from './x-login.service';
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
    private readonly wallets: WalletLoginService,
    private readonly x: XLoginService,
  ) {}

  getConfig(): AuthConfigDto {
    return {
      botUsername: config.botUsername,
      // bot_id — the numeric token prefix (public), needed by the frontend for
      // Telegram.Login.auth with a custom button
      botId: config.botToken ? config.botToken.split(':')[0] : null,
      devMode: config.devMode,
      xEnabled: this.x.enabled,
      syncIntervalMin: setting('sync.activeIntervalMin'),
    };
  }

  /** The sentence this address must sign to prove it is theirs */
  walletChallenge(address: string): Promise<WalletChallengeDto> {
    return this.wallets.challenge(address);
  }

  /** A signed challenge becomes the same session every other sign-in gives */
  async walletVerify(nonce: string, signature: string): Promise<AuthResponseDto> {
    return this.finishLogin(await this.users.upsertWallet(await this.wallets.verify(nonce, signature)));
  }

  /** Where to send the browser to sign in with X */
  xStart(): Promise<{ url: string }> {
    return this.x.start();
  }

  /** The browser came back from X: the code becomes the same session any sign-in gives */
  async xCallback(code: string, state: string): Promise<AuthResponseDto> {
    return this.finishLogin(await this.users.upsertX(await this.x.callback(code, state)));
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

  /**
   * Start connecting a Telegram chat as this user's alert delivery address.
   * The same deep link a sign-in uses; the token is what makes it mean
   * something else when the bot asks about it.
   */
  async connectStart(userId: string): Promise<TelegramConnectStartDto> {
    if (!config.botToken || !config.botUsername) {
      throw new ServiceUnavailableException('The Telegram bot is not configured');
    }
    const token = randomBytes(24).toString('base64url');
    await this.logins.createConnect(token, userId);
    return { token, deepLink: `https://t.me/${config.botUsername}?start=${token}` };
  }

  /** The tab asking whether its connect link has been pressed yet */
  async connectPoll(userId: string, token: string): Promise<TelegramConnectPollDto> {
    if (await this.logins.connectPending(token, userId)) {
      return { pending: true, connected: false };
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return { pending: false, connected: user?.alertChatId != null };
  }

  async connectRemove(userId: string): Promise<{ ok: true }> {
    await this.users.unbindAlertChat(userId);
    return { ok: true };
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
    return this.toMe(user, portfolio.slug, await this.ownedPortfolios(user.id));
  }

  private async finishLogin(user: User): Promise<AuthResponseDto> {
    const portfolio = await this.users.ensurePortfolio(user);
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, me: this.toMe(user, portfolio.slug, await this.ownedPortfolios(user.id)) };
  }

  /** Everything this account owns, oldest first — claims can make it several */
  private async ownedPortfolios(userId: string): Promise<OwnedPortfolioDto[]> {
    const owned = await this.prisma.portfolioOwner.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { portfolio: { select: { slug: true, name: true } } },
    });
    return owned.map((o) => ({ slug: o.portfolio.slug, name: o.portfolio.name }));
  }

  private toMe(user: User, portfolioSlug: string, portfolios: OwnedPortfolioDto[]): MeDto {
    return {
      id: user.id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Anonymous',
      username: user.username,
      photoUrl: user.photoUrl,
      portfolioSlug,
      telegramLinked: user.telegramId !== null,
      alertChatConnected: user.alertChatId !== null,
      portfolios,
      // Decides whether the browser draws the tab, and nothing else — every
      // admin route asks the database again for itself
      isAdmin: user.isAdmin,
    };
  }
}
