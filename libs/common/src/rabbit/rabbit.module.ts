import { Module, type DynamicModule } from '@nestjs/common';
import { RABBIT_URL, RabbitService } from './rabbit.service';

@Module({})
export class RabbitModule {
  /** `url` empty or null disables the queue entirely — see RabbitService */
  static forRoot(url: string | null): DynamicModule {
    return {
      module: RabbitModule,
      providers: [{ provide: RABBIT_URL, useValue: url || null }, RabbitService],
      exports: [RabbitService],
      global: true,
    };
  }
}
