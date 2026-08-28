import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MetricsCollectorsService } from './metrics-collectors.service';
import { ScanConsumerService } from './scan-consumer.service';
import { ScanProducerService } from './scan-producer.service';
import { ScanResultConsumerService } from './scan-result-consumer.service';
import { SyncService } from './sync.service';

@Module({
  // Drives ScanProducerService's @Interval, and stops it with the app
  imports: [ScheduleModule.forRoot()],
  providers: [
    SyncService,
    ScanProducerService,
    ScanConsumerService,
    ScanResultConsumerService,
    MetricsCollectorsService,
  ],
  // InternalScanController reaches for these to scan a just-added wallet
  exports: [SyncService, ScanConsumerService, ScanResultConsumerService],
})
export class SyncModule {}
