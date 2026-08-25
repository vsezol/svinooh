import { Module } from '@nestjs/common';
import { MetricsModule } from '@svinooh/common';
import { PrismaModule } from '@svinooh/db';
import { HealthController } from './health.controller';
import { InternalScanController } from './internal-scan.controller';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [PrismaModule, MetricsModule, SyncModule],
  controllers: [HealthController, InternalScanController],
})
export class AppModule {}
