import { Module } from '@nestjs/common';
import { MetricsModule, RabbitModule } from '@svinooh/common';
import { BrowserModule } from './browser.module';
import { config } from './config';
import { HealthController } from './health.controller';
import { ScanConsumerService } from './queue/scan-consumer.service';

@Module({
  imports: [MetricsModule, RabbitModule.forRoot(config.rabbitUrl), BrowserModule],
  controllers: [HealthController],
  providers: [ScanConsumerService],
})
export class AppModule {}
