import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiProxyModule } from './ai-proxy/ai-proxy.module';
import { AuthProxyModule } from './auth-proxy/auth-proxy.module';
import { CacheModule } from './cache/cache.module';
import { config } from './config';
import { HealthController } from './health.controller';
import { MetricsModule } from '@svinooh/common';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PrismaModule } from '@svinooh/db';

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
    AiProxyModule,
    PortfolioModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
