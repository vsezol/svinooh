import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DepositBuiltDto } from '@svinooh/shared';
import { config } from '../config';

interface WireDeposit {
  transaction: string;
  fee_payer: string;
  instructions: number;
  blockhash: string;
  last_valid_block_height: string;
}

const THE_CALLER_CAN_FIX = new Set([400, 404, 422]);

@Injectable()
export class DepositsService {
  private readonly log = new Logger(DepositsService.name);

  async build(poolId: string, amount: string, owner: string): Promise<DepositBuiltDto> {
    const answered = await fetch(
      `${config.earnApiUrl}/v1/lend/pools/${encodeURIComponent(poolId)}/deposit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount, owner }),
      },
    ).catch(() => null);
    if (!answered) {
      throw new ServiceUnavailableException('the earn service did not answer');
    }

    const body = (await answered.json().catch(() => null)) as
      | { data?: WireDeposit; detail?: string }
      | null;

    if (!answered.ok) {
      const said = body?.detail ?? `the deposit could not be built (${answered.status})`;
      throw THE_CALLER_CAN_FIX.has(answered.status)
        ? new BadRequestException(said)
        : new ServiceUnavailableException(said);
    }
    if (!body?.data) {
      throw new ServiceUnavailableException('the earn service answered without a transaction');
    }

    this.log.log(`built ${amount} into ${poolId} for ${owner.slice(0, 6)}…`);
    return {
      transaction: body.data.transaction,
      feePayer: body.data.fee_payer,
      instructions: body.data.instructions,
      blockhash: body.data.blockhash,
      lastValidBlockHeight: body.data.last_valid_block_height,
    };
  }
}
