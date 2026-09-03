import { Module } from '@nestjs/common';
import { AdminProxyController } from './admin-proxy.controller';
import { AdminClient } from './admin.client';
import { AdminGuard } from './admin.guard';

@Module({
  controllers: [AdminProxyController],
  providers: [AdminClient, AdminGuard],
})
export class AdminProxyModule {}
