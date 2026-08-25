import { Module } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { SyncModule } from '../sync/sync.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [SyncModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, RequiredAuthGuard, OptionalAuthGuard],
})
export class PortfolioModule {}
