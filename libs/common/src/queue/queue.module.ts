import { Module, type DynamicModule } from '@nestjs/common';
import type { QueueConfig } from './queue';
import { QUEUE_CONFIG, QueueService } from './queue.service';

@Module({})
export class QueueModule {
  /** A null config disables the queue entirely — see QueueService */
  static forRoot(config: QueueConfig | null): DynamicModule {
    return {
      module: QueueModule,
      providers: [{ provide: QUEUE_CONFIG, useValue: config }, QueueService],
      exports: [QueueService],
      global: true,
    };
  }
}
