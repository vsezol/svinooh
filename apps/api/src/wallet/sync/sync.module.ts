import { Module } from '@nestjs/common';
import { AlertsModule } from '../../alerts/alerts.module';
import { LandingOverlay } from './landing-overlay';
import { MetricsCollectorsService } from './metrics-collectors.service';
import { ScanConsumerService } from './scan-consumer.service';
import { ScanProducerService } from './scan-producer.service';
import { ScanResultConsumerService } from './scan-result-consumer.service';
import { SyncService } from './sync.service';

@Module({
  // The writer tells the collector what an address looks like once the
  // reading is stored — see SyncService.announce
  imports: [AlertsModule],
  providers: [
    SyncService,
    ScanProducerService,
    ScanConsumerService,
    ScanResultConsumerService,
    MetricsCollectorsService,
    LandingOverlay,
  ],
  // ScanRequests takes the claim on an address before it publishes; nothing
  // else outside this directory sees any of these
  exports: [SyncService, LandingOverlay],
})
export class SyncModule {}
