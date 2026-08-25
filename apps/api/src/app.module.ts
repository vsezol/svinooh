import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthProxyModule } from './auth-proxy/auth-proxy.module';
import { CacheModule } from './cache/cache.module';
import { config } from './config';
import { HealthController } from './health.controller';
import { MetricsModule } from '@svinooh/common';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PrismaModule } from '@svinooh/db';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    CacheModule,
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
    AuthProxyModule,
    PortfolioModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
