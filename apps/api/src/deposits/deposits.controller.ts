import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import type { DepositBuildDto, DepositBuiltDto } from '@svinooh/shared';
import { DepositsService } from './deposits.service';

@Controller('deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Post('build')
  @UseGuards(RequiredAuthGuard)
  async build(@Body() body: DepositBuildDto): Promise<DepositBuiltDto> {
    const { poolId, amount, owner } = body ?? {};
    if (!poolId || !amount || !owner) {
      throw new BadRequestException('poolId, amount and owner are all required');
    }
    return this.deposits.build(poolId, amount, owner);
  }
}
