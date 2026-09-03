import { Module } from '@nestjs/common';
import { PrismaModule } from '@svinooh/db';
import { HealthController } from './health.controller';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, SettingsController],
  providers: [SettingsService],
})
export class AppModule {}
