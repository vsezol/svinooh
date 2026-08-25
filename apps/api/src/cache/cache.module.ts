import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// Глобальный — CacheService доступен всем модулям без повторного импорта.
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
