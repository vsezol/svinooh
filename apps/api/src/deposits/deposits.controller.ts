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
    const { poolId, amount, owner, action = 'deposit', fromPoolId, payWith, receiveAs } = body ?? {};
    if (!['deposit', 'withdraw', 'move', 'swap'].includes(action)) {
      throw new BadRequestException(`${action} is not something a card can ask for`);
    }
    if (!amount || !owner) {
      throw new BadRequestException('amount and owner are both required');
    }
    if (action === 'swap' ? !payWith || !receiveAs : !poolId) {
      throw new BadRequestException(
        action === 'swap'
          ? 'a swap needs payWith and receiveAs, the coins it spends and ends as'
          : `a ${action} needs poolId, the pool the card is about`,
      );
    }
    if (action === 'move' && !fromPoolId) {
      throw new BadRequestException('a move needs fromPoolId, the pool the money leaves');
    }
    if (action === 'deposit' && amount === 'all' && !payWith) {
      throw new BadRequestException('a deposit needs a number of tokens');
    }
    return this.deposits.build({ poolId, amount, owner, action, fromPoolId, payWith, receiveAs });
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
