import { Module } from '@nestjs/common';
import { MetricsCollectorsService } from './metrics-collectors.service';
import { ScanConsumerService } from './scan-consumer.service';
import { ScanProducerService } from './scan-producer.service';
import { ScanResultConsumerService } from './scan-result-consumer.service';
import { SyncService } from './sync.service';

@Module({
  imports: [],
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
