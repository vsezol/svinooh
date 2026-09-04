import { Module } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import { config } from '../config';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CryptomusClient } from './cryptomus.client';
import { NowPaymentsClient } from './nowpayments.client';
import { PremiumService } from './premium.service';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    PremiumService,
    RequiredAuthGuard,
    {
      provide: CryptomusClient,
      useFactory: () =>
        new CryptomusClient(config.cryptomusMerchantId, config.cryptomusApiKey, config.cryptomusApiUrl),
    },
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
