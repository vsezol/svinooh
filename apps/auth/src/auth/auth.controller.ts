import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { TelegramAuthPayload } from '@svinooh/shared';
import { CurrentUserId, RequiredAuthGuard } from '@svinooh/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('config')
  getConfig() {
    return this.auth.getConfig();
  }

  @Post('telegram')
  telegram(@Body() body: TelegramAuthPayload) {
    return this.auth.telegramLogin(body);
  }

  @Post('telegram/start')
  telegramStart() {
    return this.auth.telegramStart();
  }

  @Get('telegram/poll')
  telegramPoll(@Query('token') token?: string) {
    return this.auth.telegramPoll(token ?? '');
  }

  @Post('x/start')
  xStart() {
    return this.auth.xStart();
  }

  @Post('x/callback')
  xCallback(@Body() body: { code?: string; state?: string }) {
    return this.auth.xCallback(body?.code ?? '', body?.state ?? '');
  }

  /** Redeem a sign-in link from the bot — see AuthService.issueLoginLink */
  @Post('link')
  link(@Body() body: { token?: string }) {
    return this.auth.loginWithLink(body?.token ?? '');
  }

  @Post('dev')
  dev(@Body() body: { name?: string }) {
    return this.auth.devLogin(body?.name ?? '');
  }

  @Get('me')
  @UseGuards(RequiredAuthGuard)
  me(@CurrentUserId() userId: string) {
    return this.auth.me(userId);
  }
}
