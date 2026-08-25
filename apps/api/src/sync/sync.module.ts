import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { MetricsCollectorsService } from './metrics-collectors.service';
import { ScanConsumerService } from './scan-consumer.service';
import { ScanProducerService } from './scan-producer.service';
import { SyncService } from './sync.service';

@Module({
  imports: [QueueModule],
  providers: [SyncService, ScanProducerService, ScanConsumerService, MetricsCollectorsService],
  exports: [SyncService],
})
export class SyncModule {}
