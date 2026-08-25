import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { AuthService } from './auth.service';
import { TelegramBotService } from './telegram-bot.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TelegramBotService, RequiredAuthGuard, OptionalAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
