import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import type { DepositBuildDto, DepositBuiltDto } from '@svinooh/shared';
import { DepositsService } from './deposits.service';
import { DepositNotSupportedError } from './types';

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
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      throw new BadRequestException('amount must be a positive number of tokens');
    }
    try {
      return await this.deposits.build(poolId, amount, owner);
    } catch (error) {
      if (error instanceof DepositNotSupportedError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
