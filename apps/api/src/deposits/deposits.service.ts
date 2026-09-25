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
  DepositStepDto,
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
    action?: 'provide' | 'close' | 'rebalance';
    pool_id?: string;
    amount?: string;
    pay_with?: string;
    receive_as?: string;
    position?: string;
    amount_x?: string;
    amount_y?: string;
    below_pct?: string;
    above_pct?: string;
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

type Built = DepositBuildDto & Required<Pick<DepositBuildDto, 'owner' | 'action'>>;

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
  const liquidity = {
    amount_x: asked.amountX,
    amount_y: asked.amountY,
    below_pct: asked.belowPct,
    above_pct: asked.abovePct,
  };
  if (action === 'provide') {
    const spend = fromPoolId ? { from: fromPoolId, amount } : payWith ? { coin: payWith, amount } : {};
    return [`/v1/liquidity/pools/${pool}/provide`, { owner, ...spend, ...liquidity }];
  }
  if (action === 'close' || action === 'rebalance') {
    const position = encodeURIComponent(asked.position ?? '');
    return [`/v1/liquidity/pools/${pool}/positions/${position}/${action}`, { owner, ...liquidity }];
  }
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

const stepOf = (then: NonNullable<WireDeposit['then']>): DepositStepDto => {
  const step: Record<string, string | undefined> = {
    action: then.action,
    poolId: then.pool_id,
    amount: then.amount,
    payWith: then.pay_with,
    receiveAs: then.receive_as,
    position: then.position,
    amountX: then.amount_x,
    amountY: then.amount_y,
    belowPct: then.below_pct,
    abovePct: then.above_pct,
  };
  return {
    ...Object.fromEntries(Object.entries(step).filter(([, value]) => value !== undefined)),
    holding: then.holding,
  } as DepositStepDto;
};

/** Where a build goes, for the log: "EPjFWd… -> PRIME", "PRIME -> as So1111…". */
const routeOf = ({ poolId, fromPoolId, payWith, receiveAs, position }: Built): string => {
  const from = fromPoolId ?? (payWith ? `${payWith.slice(0, 6)}…` : null);
  const as = receiveAs ? `as ${receiveAs.slice(0, 6)}…` : null;
  const at = position ? `position ${position.slice(0, 6)}…` : null;
  return [from, poolId, as, at].filter(Boolean).join(' -> ');
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
    const how = amount ?? [asked.amountX, asked.amountY].filter(Boolean).join(' + ');
    this.log.log(`built ${action} ${how} ${routeOf(asked)} for ${owner.slice(0, 6)}…`);
    const then = data.then;
    return {
      transaction: data.transaction,
      feePayer: data.fee_payer,
      instructions: data.instructions,
      blockhash: data.blockhash,
      lastValidBlockHeight: data.last_valid_block_height,
      ...(then ? { then: stepOf(then) } : {}),
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
