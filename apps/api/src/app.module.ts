import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { config } from './config';
import { HealthController } from './health.controller';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PrismaModule } from './prisma.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
    AuthModule,
    PortfolioModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
