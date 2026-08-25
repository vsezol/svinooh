import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Portfolio, User } from '@prisma/client';
import type { AuthConfigDto, AuthResponseDto, MeDto, TelegramAuthPayload } from '@svinooh/shared';
import { randomSlug } from '../common/util';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { verifyTelegramLogin } from './telegram';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  getConfig(): AuthConfigDto {
    return {
      botUsername: config.botUsername,
      // bot_id — числовой префикс токена (публичный), нужен фронту для
      // Telegram.Login.auth со своей кнопкой
      botId: config.botToken ? config.botToken.split(':')[0] : null,
      devMode: config.devMode,
      syncIntervalMin: config.syncIntervalMin,
    };
  }

  async telegramLogin(payload: TelegramAuthPayload): Promise<AuthResponseDto> {
    if (!config.botToken) {
      throw new ServiceUnavailableException(
        'Вход через Telegram не настроен: нет TELEGRAM_BOT_TOKEN',
      );
    }
    const problem = verifyTelegramLogin(payload, config.botToken);
    if (problem) throw new UnauthorizedException(`Данные Telegram не прошли проверку: ${problem}`);

    const telegramId = BigInt(payload.id);
    const profile = {
      firstName: payload.first_name ?? null,
      lastName: payload.last_name ?? null,
      username: payload.username ?? null,
      photoUrl: payload.photo_url ?? null,
    };
    const user = await this.prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...profile },
      update: profile,
    });
    return this.finishLogin(user);
  }

  /** Локальная разработка без бота: включается AUTH_DEV_MODE=true */
  async devLogin(nameRaw: string): Promise<AuthResponseDto> {
    if (!config.devMode) throw new ForbiddenException('Dev-вход выключен');
    const name = String(nameRaw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32);
    if (name.length < 2) {
      throw new BadRequestException('Имя: латиница/цифры/дефис, минимум 2 символа');
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

  /** Портфель создаётся при первом входе. Пока один; схема допускает несколько. */
  private async ensurePortfolio(user: User): Promise<Portfolio> {
    const existing = await this.prisma.portfolio.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    const display = user.username ? `@${user.username}` : user.firstName || 'без имени';
    return this.prisma.portfolio.create({
      data: { userId: user.id, slug: randomSlug(), name: `Портфель ${display}` },
    });
  }

  private toMe(user: User, portfolioSlug: string): MeDto {
    return {
      id: user.id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Аноним',
      username: user.username,
      photoUrl: user.photoUrl,
      portfolioSlug,
    };
  }
}
