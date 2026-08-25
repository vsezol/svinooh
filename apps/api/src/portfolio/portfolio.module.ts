import { Module } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  controllers: [PortfolioController],
  providers: [PortfolioService, RequiredAuthGuard, OptionalAuthGuard],
})
export class PortfolioModule {}
