import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminModule } from './admin/admin.module';
import { AuthProxyModule } from './auth-proxy/auth-proxy.module';
import { BillingModule } from './billing/billing.module';
import { config } from './config';
import { AgentConfigController } from './agent-config.controller';
import { HealthController } from './health.controller';
import { MetricsModule, RabbitModule } from '@svinooh/common';
import { DepositsModule } from './deposits/deposits.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { WalletModule } from './wallet/wallet.module';
import { PrismaModule } from '@svinooh/db';

@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    // Only billing publishes from the api (the thank-you after a payment);
    // without a broker the publish is a no-op, never an error
    RabbitModule.forRoot(config.rabbitUrl),
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
    AuthProxyModule,
    DepositsModule,
    PortfolioModule,
    BillingModule,
    AdminModule,
    WalletModule,
  ],
  controllers: [HealthController, AgentConfigController],
})
export class AppModule {}
