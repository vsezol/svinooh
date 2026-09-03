import { Module } from '@nestjs/common';
import { AdminProxyController } from './admin-proxy.controller';

@Module({ controllers: [AdminProxyController] })
export class AdminProxyModule {}
