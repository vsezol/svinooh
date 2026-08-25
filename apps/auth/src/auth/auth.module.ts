import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { AuthService } from './auth.service';
import { TelegramBotService } from './telegram-bot.service';
import { UserService } from './user.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TelegramBotService, UserService, RequiredAuthGuard, OptionalAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
