import { Module } from '@nestjs/common';
import { MetricsModule } from '@svinooh/common';
import { BrowserModule } from './browser.module';
import { HealthController } from './health.controller';
import { ScanController } from './scan.controller';

@Module({
  imports: [MetricsModule, BrowserModule],
  controllers: [HealthController, ScanController],
})
export class AppModule {}
