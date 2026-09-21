import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@svinooh/db';
import type {
  DepositBuildDto,
  DepositBuiltDto,
  DepositLandingDto,
  DepositLandingStatus,
} from '@svinooh/shared';
import { config } from '../config';
import { ScanRequests } from '../wallet/scan-requests.service';

interface WireDeposit {
  transaction: string;
  fee_payer: string;
  instructions: number;
  blockhash: string;
  last_valid_block_height: string;
  then?: {
    pool_id?: string;
    amount: string;
    pay_with?: string;
    receive_as?: string;
    holding: string;
  };
}

interface WireLanding {
  signature: string;
  status: DepositLandingStatus;
  slot: number | null;
  error: string | null;
}

const THE_CALLER_CAN_FIX = new Set([400, 404, 422]);

type Built = Required<Pick<DepositBuildDto, 'amount' | 'owner' | 'action'>> &
  Pick<DepositBuildDto, 'poolId' | 'fromPoolId' | 'payWith' | 'receiveAs'>;

const CHAINS: Record<string, string> = { sol: 'SOL' };

/**
 * Which of earn's endpoints builds what a card asks for. A deposit and a
 * withdrawal of the pool's own token are plain; paying with another coin,
 * ending as another, or leaving another pool is a move, swapped on the way
 * wherever the tokens differ.
 */
function earnRequestFor(asked: Built): [string, Record<string, string | undefined>] {
  const { poolId, amount, owner, action, fromPoolId, payWith, receiveAs } = asked;
  const pool = encodeURIComponent(poolId ?? '');
  if (action === 'swap') {
    return ['/v1/lend/moves', { from_coin: payWith, to_coin: receiveAs, amount, owner }];
  }
  if (action === 'move') {
    return ['/v1/lend/moves', { from: fromPoolId, to: poolId, amount, owner }];
  }
  if (action === 'withdraw') {
    return receiveAs
      ? ['/v1/lend/moves', { from: poolId, to_coin: receiveAs, amount, owner }]
      : [`/v1/lend/pools/${pool}/withdraw`, { amount, owner }];
  }
  return payWith
    ? ['/v1/lend/moves', { from_coin: payWith, to: poolId, amount, owner }]
    : [`/v1/lend/pools/${pool}/deposit`, { amount, owner }];
}

/** Where a build goes, for the log: "EPjFWd… -> PRIME", "PRIME -> as So1111…". */
const routeOf = ({ poolId, fromPoolId, payWith, receiveAs }: Built): string => {
  const from = fromPoolId ?? (payWith ? `${payWith.slice(0, 6)}…` : null);
  const as = receiveAs ? `as ${receiveAs.slice(0, 6)}…` : null;
  return [from, poolId, as].filter(Boolean).join(' -> ');
};

@Injectable()
export class DepositsService {
  private readonly log = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scans: ScanRequests,
  ) {}

  async build(asked: Built): Promise<DepositBuiltDto> {
    const { amount, owner, action } = asked;
    const [path, body] = earnRequestFor(asked);
    const data = await this.earn<WireDeposit>(path, { method: 'POST', body: JSON.stringify(body) });
    this.log.log(`built ${action} ${amount} ${routeOf(asked)} for ${owner.slice(0, 6)}…`);
    const then = data.then;
    return {
      transaction: data.transaction,
      feePayer: data.fee_payer,
      instructions: data.instructions,
      blockhash: data.blockhash,
      lastValidBlockHeight: data.last_valid_block_height,
      ...(then
        ? {
            then: {
              ...(then.pool_id ? { poolId: then.pool_id } : {}),
              amount: then.amount,
              ...(then.pay_with ? { payWith: then.pay_with } : {}),
              ...(then.receive_as ? { receiveAs: then.receive_as } : {}),
              holding: then.holding,
            },
          }
        : {}),
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

    this.scans.landed(tracked.walletId);
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

}
