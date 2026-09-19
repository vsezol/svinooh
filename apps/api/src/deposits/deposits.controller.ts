import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId, RequiredAuthGuard } from '@svinooh/common';
import type {
  DepositBuildDto,
  DepositBuiltDto,
  DepositLandedDto,
  DepositLandingDto,
} from '@svinooh/shared';
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

  @Post('landed')
  @UseGuards(RequiredAuthGuard)
  async landed(
    @Body() body: DepositLandedDto,
    @CurrentUserId() userId: string,
  ): Promise<DepositLandingDto> {
    const { signature, owner, network } = body ?? {};
    if (!signature || !owner || !network) {
      throw new BadRequestException('signature, owner and network are all required');
    }
    return this.deposits.landed(signature, owner, network, userId);
  }
}
