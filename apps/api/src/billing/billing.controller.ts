import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId, RequiredAuthGuard } from '@svinooh/common';
import type { ProOfferDto } from '@svinooh/shared';
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
  checkout(@CurrentUserId() userId: string) {
    return this.billing.checkout(userId);
  }

  /**
   * The gateways calling back about payments. No JWT — the caller is a
   * machine, and its authentication is a signature over the body, checked in
   * the service before anything is read. Both routes stay mounted whatever
   * BILLING_PROVIDER says, so switching providers never strands an invoice
   * opened on the other side.
   */
  @Post('webhook/cryptomus')
  @HttpCode(200)
  async cryptomusWebhook(@Body() body: Record<string, unknown>) {
    await this.billing.cryptomusWebhook(body ?? {});
    return { ok: true };
  }

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
