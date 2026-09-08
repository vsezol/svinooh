import { Module } from '@nestjs/common';
import { PrismaModule } from '@svinooh/db';
import { HealthController } from './health.controller';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { ModelsService } from './settings/models.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, SettingsController],
  providers: [SettingsService, ModelsService],
})
export class AppModule {}
