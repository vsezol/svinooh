import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@svinooh/db';
import type {
  DepositBuildDto,
  DepositBuiltDto,
  DepositLandingDto,
  DepositLandingStatus,
  DepositStepDto,
} from '@svinooh/shared';
import { EarnApi, type WireEffects, type WireTransaction } from '../earn/earn.api';
import { problemOf } from '../earn/api/problems';
import { ScanRequests, type WalletAfterLanding } from '../wallet/scan-requests.service';

/** The one shape of a built transaction the deposits module reads */
type WireDeposit = WireTransaction & {
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
};

const THE_CALLER_CAN_FIX = new Set([400, 404, 422]);

const EFFECTS_WAIT_MS = 8_000;

const numberOr = (value: string | null, fallback: number | null): number | null =>
  value === null ? fallback : Number(value);

function walletAfter(wire: WireEffects): WalletAfterLanding {
  return {
    slot: wire.slot,
    coins: wire.coins.map((one) => ({
      mint: one.mint,
      symbol: one.symbol,
      amount: Number(one.amount),
      priceUsd: numberOr(one.price_usd, null),
    })),
    vaults: wire.vaults.map((one) => ({
      address: one.address,
      farm: one.farm,
      sharesMint: one.shares_mint,
      name: one.name,
      token: one.token.symbol,
      amount: Number(one.amount),
      priceUsd: numberOr(one.price_usd, 0) ?? 0,
      apy: numberOr(one.apy, null),
    })),
    pairs: wire.pairs.map((one) => ({
      address: one.pool.id.split(':').pop() ?? '',
      x: one.pool.x.symbol,
      y: one.pool.y.symbol,
      feePct: Number(one.pool.base_fee_pct),
      price: Number(one.pool.price),
      priceXUsd: Number(one.price_x_usd),
      priceYUsd: Number(one.price_y_usd),
      positions: one.positions.map((held) => ({
        address: held.address,
        amountX: Number(held.amount_x),
        amountY: Number(held.amount_y),
        lowerPrice: Number(held.lower_price),
        upperPrice: Number(held.upper_price),
        inRange: held.in_range,
        feesUsd: Number(held.fees_usd),
      })),
    })),
  };
}

type Built = DepositBuildDto & Required<Pick<DepositBuildDto, 'owner' | 'action'>>;

const CHAINS: Record<string, string> = { sol: 'SOL' };

/**
 * Which of earn's calls builds what a card asks for. A deposit and a
 * withdrawal of the pool's own token are plain; paying with another coin,
 * ending as another, or leaving another pool is a move, swapped on the way
 * wherever the tokens differ. The bodies are the wire bodies the routes take:
 * earn parses them the same way whether they arrive by HTTP or from here.
 */
function earnBuild(earn: EarnApi, asked: Built): Promise<WireTransaction> {
  const { poolId = '', amount, owner, action, fromPoolId, payWith, receiveAs } = asked;
  // What JSON did on the wire: a field that is not there is not there
  const liquidity = compact({
    amount_x: asked.amountX,
    amount_y: asked.amountY,
    below_pct: asked.belowPct,
    above_pct: asked.abovePct,
  });
  const built = (answer: Promise<{ data: WireTransaction }>) => answer.then((a) => a.data);
  if (action === 'provide') {
    const spend = fromPoolId ? { from: fromPoolId, amount } : payWith ? { coin: payWith, amount } : {};
    return earn.provide(poolId, { owner, ...spend, ...liquidity });
  }
  if (action === 'close') return earn.close(poolId, asked.position ?? '', { owner, ...liquidity });
  if (action === 'rebalance')
    return earn.rebalance(poolId, asked.position ?? '', {
      owner,
      ...liquidity,
    });
  if (action === 'swap') return built(earn.move({ from_coin: payWith, to_coin: receiveAs, amount, owner }));
  if (action === 'move') return built(earn.move({ from: fromPoolId, to: poolId, amount, owner }));
  if (action === 'withdraw') {
    return receiveAs
      ? built(earn.move({ from: poolId, to_coin: receiveAs, amount, owner }))
      : built(earn.withdraw(poolId, { amount, owner }));
  }
  return payWith
    ? built(earn.move({ from_coin: payWith, to: poolId, amount, owner }))
    : built(earn.deposit(poolId, { amount, owner }));
}

const compact = (body: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as Record<
    string,
    string
  >;

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
    private readonly earnApi: EarnApi,
  ) {}

  async build(asked: Built): Promise<DepositBuiltDto> {
    const { amount, owner, action } = asked;
    const data = (await this.earn(() => earnBuild(this.earnApi, asked))) as WireDeposit;
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

    const seen = await this.earn(() => this.earnApi.landing(signature, { network }));
    const status = seen.status as DepositLandingStatus;
    if (status !== 'landed') {
      return {
        status,
        slot: seen.slot,
        error: seen.error,
        tracked: false,
        portfolio: null,
      };
    }

    const tracked = await this.prisma.portfolioWallet.findFirst({
      where: {
        wallet: { chain, address: owner },
        portfolio: { owner: { userId } },
      },
      select: { walletId: true, portfolio: { select: { slug: true } } },
    });
    if (!tracked) {
      this.log.log(`${signature.slice(0, 8)}… landed for an address nobody here tracks`);
      return {
        status: 'landed',
        slot: seen.slot,
        error: null,
        tracked: false,
        portfolio: null,
      };
    }

    this.log.log(`${signature.slice(0, 8)}… landed, rescanning ${owner.slice(0, 6)}…`);
    void this.afterLanding(signature, owner, network).then((left) =>
      this.scans.landed(tracked.walletId, left),
    );
    return {
      status: 'landed',
      slot: seen.slot,
      error: null,
      tracked: true,
      portfolio: tracked.portfolio.slug,
    };
  }

  private async afterLanding(
    signature: string,
    owner: string,
    network: string,
  ): Promise<WalletAfterLanding | null> {
    // Bounded, as the HTTP call it replaces was: reading what a transaction
    // left behind asks the chain, and a slow node must not hold the rescan
    let timer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${EFFECTS_WAIT_MS}ms`)), EFFECTS_WAIT_MS);
    });
    try {
      const found = await Promise.race([this.earnApi.effects(signature, { network, owner }), gaveUp]);
      return found ? walletAfter(found) : null;
    } catch (unread) {
      this.log.warn(`what ${signature.slice(0, 8)}… left could not be read: ${(unread as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * An earn failure, as this module's callers should see it: what the caller
   * can fix is a 400 with earn's own words, what earn cannot do right now is a
   * 503. The same split the HTTP client here made on earn's status codes.
   */
  private async earn<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const problem = problemOf(error);
      if (!problem) throw error;
      throw THE_CALLER_CAN_FIX.has(problem.status)
        ? new BadRequestException(problem.detail)
        : new ServiceUnavailableException(problem.detail);
    }
  }
}
