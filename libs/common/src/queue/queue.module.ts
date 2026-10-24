import { Module, type DynamicModule } from '@nestjs/common';
import { QUEUE_URL, QueueService } from './queue.service';

@Module({})
export class QueueModule {
  /** `url` empty or null disables the queue entirely — see QueueService */
  static forRoot(url: string | null): DynamicModule {
    return {
      module: QueueModule,
      providers: [{ provide: QUEUE_URL, useValue: url || null }, QueueService],
      exports: [QueueService],
      global: true,
    };
  }
}
