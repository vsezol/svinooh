import { Module } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { BillingModule } from '../billing/billing.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [BillingModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, RequiredAuthGuard, OptionalAuthGuard],
})
export class PortfolioModule {}
