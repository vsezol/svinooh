import { Module } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import { WalletModule } from '../wallet/wallet.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [WalletModule],
  controllers: [DepositsController],
  providers: [DepositsService, RequiredAuthGuard],
})
export class DepositsModule {}
