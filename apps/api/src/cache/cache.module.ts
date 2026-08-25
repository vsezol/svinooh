import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// Global — CacheService is available to all modules without re-importing.
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
