import { Module } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from '../auth/auth.guard';
import { SyncModule } from '../sync/sync.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [SyncModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, RequiredAuthGuard, OptionalAuthGuard],
})
export class PortfolioModule {}
