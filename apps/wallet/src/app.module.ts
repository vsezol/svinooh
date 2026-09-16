import { Module } from '@nestjs/common';
import { MetricsModule, QueueModule } from '@svinooh/common';
import { PrismaModule } from '@svinooh/db';
import { config } from './config';
import { HealthController } from './health.controller';
import { InternalScanController } from './internal-scan.controller';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [PrismaModule, MetricsModule, QueueModule.forRoot(config.queue), SyncModule],
  controllers: [HealthController, InternalScanController],
})
export class AppModule {}
