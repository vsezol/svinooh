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
    const { poolId, amount, owner, action = 'deposit', fromPoolId } = body ?? {};
    if (!poolId || !amount || !owner) {
      throw new BadRequestException('poolId, amount and owner are all required');
    }
    if (action === 'move' && !fromPoolId) {
      throw new BadRequestException('a move needs fromPoolId, the pool the money leaves');
    }
    if (action === 'deposit' && amount === 'all') {
      throw new BadRequestException('a deposit needs a number of tokens');
    }
    if (!['deposit', 'withdraw', 'move'].includes(action)) {
      throw new BadRequestException(`${action} is not something a card can ask for`);
    }
    return this.deposits.build({ poolId, amount, owner, action, fromPoolId });
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
