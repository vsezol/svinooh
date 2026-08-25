import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MetricsModule } from '@svinooh/common';
import { PrismaModule } from '@svinooh/db';
import { AuthModule } from './auth/auth.module';
import { config } from './config';
import { HealthController } from './health.controller';

@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
