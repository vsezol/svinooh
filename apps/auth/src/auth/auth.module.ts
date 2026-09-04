import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { AuthService } from './auth.service';
import { InternalTelegramController } from './internal-telegram.controller';
import { TelegramLoginService } from './telegram-login.service';
import { UserService } from './user.service';
import { XLoginService } from './x-login.service';

@Module({
  controllers: [AuthController, InternalTelegramController],
  providers: [AuthService, TelegramLoginService, UserService, XLoginService, RequiredAuthGuard, OptionalAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
