import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId, RequiredAuthGuard } from '@svinooh/common';
import type { CheckoutRequestDto, ProOfferDto } from '@svinooh/shared';
import { BillingService } from './billing.service';
import { PremiumService } from './premium.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly premium: PremiumService,
  ) {}

  /** The pitch, public: the marketing page draws every number from here */
  @Get('offer')
  offer(): ProOfferDto {
    return this.premium.offer();
  }

  @Get('me')
  @UseGuards(RequiredAuthGuard)
  me(@CurrentUserId() userId: string) {
    return this.billing.me(userId);
  }

  @Post('checkout')
  @UseGuards(RequiredAuthGuard)
  checkout(@CurrentUserId() userId: string, @Body() body?: CheckoutRequestDto) {
    return this.billing.checkout(userId, body?.payCurrency);
  }

  /**
   * NOWPayments calling back about a payment. No JWT — the caller is a
   * machine, and its authentication is the HMAC signature over the body,
   * checked in the service before anything is read.
   */
  @Post('webhook/nowpayments')
  @HttpCode(200)
  async nowpaymentsWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-nowpayments-sig') signature?: string,
  ) {
    await this.billing.nowpaymentsWebhook(body ?? {}, signature);
    return { ok: true };
  }
}
