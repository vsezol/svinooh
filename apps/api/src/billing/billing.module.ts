import { Module } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import { config } from '../config';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { NowPaymentsClient } from './nowpayments.client';
import { PayRailsService } from './pay-rails';
import { PremiumService } from './premium.service';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    PremiumService,
    PayRailsService,
    RequiredAuthGuard,
    {
      provide: NowPaymentsClient,
      useFactory: () =>
        new NowPaymentsClient(
          config.nowpaymentsApiKey,
          config.nowpaymentsIpnSecret,
          config.nowpaymentsApiUrl,
        ),
    },
  ],
  // The gates — what the portfolio module (and one day the agent) checks
  exports: [PremiumService],
})
export class BillingModule {}
