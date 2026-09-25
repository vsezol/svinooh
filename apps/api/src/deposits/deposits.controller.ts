import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId, RequiredAuthGuard } from '@svinooh/common';
import type {
  DepositBuildDto,
  DepositBuiltDto,
  DepositLandedDto,
  DepositLandingDto,
} from '@svinooh/shared';
import { DepositsService } from './deposits.service';

const ACTIONS = ['deposit', 'withdraw', 'move', 'swap', 'provide', 'close', 'rebalance'];

/** What a card asked for without, in words its caller can fix; null when it has all it needs. */
function whatIsMissing(asked: DepositBuildDto & { action: string }): string | null {
  const { action, poolId, amount, fromPoolId, payWith, receiveAs, position } = asked;
  const liquidity = action === 'provide' || action === 'close' || action === 'rebalance';
  if (!liquidity && !amount) return 'amount is required';
  if (action === 'swap') {
    return payWith && receiveAs ? null : 'a swap needs payWith and receiveAs, the coins it spends and ends as';
  }
  if (!poolId) return `a ${action} needs poolId, the pool the card is about`;
  if (action === 'move' && !fromPoolId) return 'a move needs fromPoolId, the pool the money leaves';
  if (action === 'deposit' && amount === 'all' && !payWith) return 'a deposit needs a number of tokens';
  if ((action === 'close' || action === 'rebalance') && !position) {
    return `a ${action} needs position, the one it acts on`;
  }
  if (action === 'provide') {
    if (!asked.belowPct || !asked.abovePct) {
      return 'placing liquidity needs belowPct and abovePct, the range around the price';
    }
    if (!(amount && (payWith || fromPoolId)) && !asked.amountX && !asked.amountY) {
      return 'placing liquidity needs amount of payWith or out of fromPoolId, or amountX and amountY';
    }
  }
  return null;
}

@Controller('deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Post('build')
  @UseGuards(RequiredAuthGuard)
  async build(@Body() body: DepositBuildDto): Promise<DepositBuiltDto> {
    const asked = body ?? ({} as DepositBuildDto);
    const { action = 'deposit', owner } = asked;
    if (!ACTIONS.includes(action)) {
      throw new BadRequestException(`${action} is not something a card can ask for`);
    }
    if (!owner) throw new BadRequestException('owner is required');
    const missing = whatIsMissing({ ...asked, action });
    if (missing) throw new BadRequestException(missing);
    return this.deposits.build({ ...asked, action, owner });
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
