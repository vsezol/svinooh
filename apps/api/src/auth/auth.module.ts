import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OptionalAuthGuard, RequiredAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RequiredAuthGuard, OptionalAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
