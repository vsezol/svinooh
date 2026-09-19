import { Module } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  controllers: [DepositsController],
  providers: [DepositsService, RequiredAuthGuard],
})
export class DepositsModule {}
