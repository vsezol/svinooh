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

  @Post('telegram/connect/start')
  @UseGuards(RequiredAuthGuard)
  connectStart(@CurrentUserId() userId: string) {
    return this.auth.connectStart(userId);
  }

  @Get('telegram/connect/poll')
  @UseGuards(RequiredAuthGuard)
  connectPoll(@CurrentUserId() userId: string, @Query('token') token?: string) {
    return this.auth.connectPoll(userId, token ?? '');
  }

  @Post('telegram/connect/remove')
  @UseGuards(RequiredAuthGuard)
  connectRemove(@CurrentUserId() userId: string) {
    return this.auth.connectRemove(userId);
  }

  /** Wallet sign-in, step one: the sentence this address is asked to sign */
  @Post('wallet/nonce')
  walletNonce(@Body() body: { address?: string }) {
    return this.auth.walletChallenge(body?.address ?? '');
  }

  /** Step two: the signature, which is the whole proof */
  @Post('wallet/verify')
  walletVerify(@Body() body: { nonce?: string; signature?: string }) {
    return this.auth.walletVerify(body?.nonce ?? '', body?.signature ?? '');
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
