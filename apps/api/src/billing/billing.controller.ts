import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId, RequiredAuthGuard } from '@svinooh/common';
import type { ProOfferDto } from '@svinooh/shared';
import { BillingService } from './billing.service';
import { PremiumService } from './premium.service';

const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * The Idempotency-Key header: a UUID from the page, or anything shaped like
 * one. None is null — a checkout asked for without one is a new attempt, as
 * it always was.
 */
export function idempotencyKeyOf(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (!KEY.test(raw)) {
    throw new BadRequestException(
      'Idempotency-Key is 8 to 128 letters, digits, dots, colons, dashes or underscores',
    );
  }
  return raw;
}

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
  checkout(@CurrentUserId() userId: string, @Headers('idempotency-key') key?: string) {
    return this.billing.checkout(userId, idempotencyKeyOf(key));
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
