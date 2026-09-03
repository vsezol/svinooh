import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminProxyModule } from './admin-proxy/admin-proxy.module';
import { AiProxyModule } from './ai-proxy/ai-proxy.module';
import { AuthProxyModule } from './auth-proxy/auth-proxy.module';
import { BillingModule } from './billing/billing.module';
import { CacheModule } from './cache/cache.module';
import { config } from './config';
import { HealthController } from './health.controller';
import { MetricsModule, RabbitModule } from '@svinooh/common';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PrismaModule } from '@svinooh/db';

@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    CacheModule,
    // Only billing publishes from the api (the thank-you after a payment);
    // without a broker the publish is a no-op, never an error
    RabbitModule.forRoot(config.rabbitUrl),
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
    AuthProxyModule,
    AiProxyModule,
    PortfolioModule,
    BillingModule,
    AdminProxyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
