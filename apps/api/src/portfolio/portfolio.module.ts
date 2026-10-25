import { Module } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { BillingModule } from '../billing/billing.module';
import { WalletModule } from '../wallet/wallet.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { SnapshotThinning } from './snapshot-thinning';

@Module({
  imports: [BillingModule, WalletModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, SnapshotThinning, RequiredAuthGuard, OptionalAuthGuard],
})
export class PortfolioModule {}
