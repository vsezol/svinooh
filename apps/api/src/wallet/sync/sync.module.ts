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
  // ScanRequests takes the claim on an address before it publishes; nothing
  // else outside this directory sees any of these
  exports: [SyncService],
})
export class SyncModule {}
