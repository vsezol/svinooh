import { Module } from '@nestjs/common';
import { AiProxyController } from './ai-proxy.controller';

@Module({
  controllers: [AiProxyController],
})
export class AiProxyModule {}
