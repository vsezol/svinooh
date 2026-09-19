import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@svinooh/db';
import type { DepositBuiltDto, DepositLandingDto, DepositLandingStatus } from '@svinooh/shared';
import { config } from '../config';

interface WireDeposit {
  transaction: string;
  fee_payer: string;
  instructions: number;
  blockhash: string;
  last_valid_block_height: string;
}

interface WireLanding {
  signature: string;
  status: DepositLandingStatus;
  slot: number | null;
  error: string | null;
}

const THE_CALLER_CAN_FIX = new Set([400, 404, 422]);

const CHAINS: Record<string, string> = { sol: 'SOL' };

@Injectable()
export class DepositsService {
  private readonly log = new Logger(DepositsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(poolId: string, amount: string, owner: string): Promise<DepositBuiltDto> {
    const data = await this.earn<WireDeposit>(
      `/v1/lend/pools/${encodeURIComponent(poolId)}/deposit`,
      { method: 'POST', body: JSON.stringify({ amount, owner }) },
    );
    this.log.log(`built ${amount} into ${poolId} for ${owner.slice(0, 6)}…`);
    return {
      transaction: data.transaction,
      feePayer: data.fee_payer,
      instructions: data.instructions,
      blockhash: data.blockhash,
      lastValidBlockHeight: data.last_valid_block_height,
    };
  }

  async landed(
    signature: string,
    owner: string,
    network: string,
    userId: string,
  ): Promise<DepositLandingDto> {
    const chain = CHAINS[network];
    if (!chain) throw new BadRequestException(`${network} deposits are not followed here yet`);

    const seen = await this.earn<WireLanding>(
      `/v1/lend/deposits/${encodeURIComponent(signature)}?network=${encodeURIComponent(network)}`,
    );
    if (seen.status !== 'landed') {
      return { status: seen.status, slot: seen.slot, error: seen.error, tracked: false, portfolio: null };
    }

    const tracked = await this.prisma.portfolioWallet.findFirst({
      where: { wallet: { chain, address: owner }, portfolio: { owner: { userId } } },
      select: { walletId: true, portfolio: { select: { slug: true } } },
    });
    if (!tracked) {
      this.log.log(`${signature.slice(0, 8)}… landed for an address nobody here tracks`);
      return { status: 'landed', slot: seen.slot, error: null, tracked: false, portfolio: null };
    }

    this.requestScan(tracked.walletId);
    this.log.log(`${signature.slice(0, 8)}… landed, rescanning ${owner.slice(0, 6)}…`);
    return {
      status: 'landed',
      slot: seen.slot,
      error: null,
      tracked: true,
      portfolio: tracked.portfolio.slug,
    };
  }

  private async earn<T>(path: string, init: RequestInit = {}): Promise<T> {
    const answered = await fetch(`${config.earnApiUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    }).catch(() => null);
    if (!answered) {
      throw new ServiceUnavailableException('the earn service did not answer');
    }

    const body = (await answered.json().catch(() => null)) as
      | { data?: T; detail?: string }
      | null;

    if (!answered.ok) {
      const said = body?.detail ?? `the earn service answered ${answered.status}`;
      throw THE_CALLER_CAN_FIX.has(answered.status)
        ? new BadRequestException(said)
        : new ServiceUnavailableException(said);
    }
    if (!body?.data) {
      throw new ServiceUnavailableException('the earn service answered with nothing');
    }
    return body.data;
  }

  private requestScan(walletId: string): void {
    void fetch(`${config.walletServiceUrl}/internal/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}
