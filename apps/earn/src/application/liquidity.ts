import { Decimal } from 'decimal.js';
import { fit } from '../domain/deposit';
import {
  pairIdOf,
  pairs,
  parsePairId,
  percentOf,
  spanOf,
  trusted,
  whyNotRange,
  type Close,
  type LiquidityPosition,
  type PairPool,
  type PairToken,
  type Provide,
  type Range,
  type Rebalance,
} from '../domain/liquidity';
import type { Token } from '../domain/pool';
import type { Take } from '../domain/withdrawal';
import type { BuiltTransaction, ReadHoldings } from './deposits';
import { DepositNotSupported, NotEnoughHeld, NothingThere, PoolNotFound } from './errors';
import type { TakenOut } from './moves';

/** Pools pairing two tokens, named by ticker or mint in either order. */
export type ReadPairPools = (first: string, second: string) => Promise<PairPool[]>;

/** One pool by its address, or null when there is none. */
export type ReadPairPool = (address: string) => Promise<PairPool | null>;

/** The positions this owner holds in pair pools. */
export type ReadLiquidityPositions = (owner: string) => Promise<LiquidityPosition[]>;

/** What a pool holds within `share` of its price either way, in its y token, or null when it cannot be read. */
export type ReadNearThePrice = (address: string, share: Decimal) => Promise<Decimal | null>;

export interface LiquidityBuilders {
  provide: (provide: Provide) => Promise<BuiltTransaction>;
  close: (close: Close, pool: PairPool) => Promise<BuiltTransaction>;
  rebalance: (
    rebalance: Rebalance,
    pool: PairPool,
    carried: { amountX: Decimal; amountY: Decimal } | null,
  ) => Promise<BuiltTransaction>;
}

/** What goes into a pool: an amount of one of its tokens, or "all" of it, or so much of each. */
export type Spend =
  | { coin: string; amount: Take }
  | { amountX: Decimal; amountY: Decimal }
  | { from: string; amount: Take };

export interface Lending {
  tokenOf(poolId: string): { name: string; token: Token };
  takeOut(poolId: string, take: Take, owner: string): Promise<TakenOut>;
}

/**
 * SOL kept back from "all of it" on top of what any spend keeps: a position
 * locks about 0.057 SOL as the rent of its account, returned when it closes.
 */
const OPENING_SOL = new Decimal('0.06');

const NATIVE = 'So11111111111111111111111111111111111111112';

/**
 * A pool, and — when a range was asked about — how many bins it spans there
 * and why it will not fit; and, when asked, the dollars it holds near its
 * price, which is the liquidity a day's fees were shared among.
 */
export interface PoolFit {
  pool: PairPool;
  bins: number | null;
  why: string | null;
  activeUsd?: Decimal | null;
}

async function activeUsdOf(pool: PairPool, share: Decimal, near: ReadNearThePrice): Promise<Decimal | null> {
  if (!pool.yUsd) return null;
  const inY = await near(pool.id.address, share);
  return inY === null ? null : inY.mul(pool.yUsd);
}

/** Where liquidity for a pair can go, and what an owner already has placed. */
export class LendLiquidity {
  constructor(
    private readonly pools_: Record<string, ReadPairPools>,
    private readonly pool_: Record<string, ReadPairPool>,
    private readonly positions_: Record<string, ReadLiquidityPositions>,
    private readonly minTvlUsd: Decimal,
    private readonly builders: Record<string, LiquidityBuilders> = {},
    private readonly holdings: Record<string, ReadHoldings> = {},
    private readonly lending: Lending | null = null,
    private readonly near: Record<string, ReadNearThePrice> = {},
  ) {}

  /**
   * Pools of this pair worth offering, most money first: both tokens
   * verified, and enough in the pool that trading through it is real. With a
   * range, each says how many of its bins that is — a pool whose bins are
   * too fine for the range in one position is kept, with why, rather than
   * dropped, since it may be the pair's deepest.
   */
  async pools(
    network: string,
    first: string,
    second: string,
    range?: Range,
    activeShare?: Decimal,
  ): Promise<PoolFit[]> {
    const read = this.pools_[network];
    if (!read) throw new DepositNotSupported(`${network} pair pools are not read here yet`);
    const found = await read(first, second);
    const fits = found
      .filter((pool) => trusted(pool) && pairs(pool, first, second))
      .filter((pool) => pool.tvlUsd.gte(this.minTvlUsd))
      .map((pool) => ({
        pool,
        bins: range ? spanOf(range, pool.binStep).bins : null,
        why: range ? whyNotRange(range, pool) : null,
      }));
    const near = this.near[network];
    if (!activeShare || !near) return fits;
    return Promise.all(
      fits.map(async (fit) => ({
        ...fit,
        activeUsd: fit.why ? null : await activeUsdOf(fit.pool, activeShare, near),
      })),
    );
  }

  async pool(id: string): Promise<PairPool> {
    const parsed = parsePairId(id);
    if (!parsed) throw new PoolNotFound(id);
    const read = this.pool_[parsed.network];
    if (!read) throw new DepositNotSupported(`${parsed.network} pair pools are not read here yet`);
    const pool = await read(parsed.address);
    if (!pool || pairIdOf(pool.id) !== id) throw new PoolNotFound(id);
    return pool;
  }

  async positions(network: string, owner: string): Promise<LiquidityPosition[]> {
    const read = this.positions_[network];
    if (!read) throw new DepositNotSupported(`${network} liquidity positions are not read here yet`);
    return read(owner);
  }

  /**
   * Liquidity placed in a pool across a range around its price, from what the
   * wallet holds of one of its tokens or of both. What the wallet holds is
   * read first: a figure a screen rounded up is what is there, and more than
   * is there is refused by name before anything is built.
   */
  async provide(poolId: string, owner: string, spend: Spend, range: Range): Promise<BuiltTransaction> {
    const pool = await this.pool(poolId);
    const why = whyNotRange(range, pool);
    if (why) throw new DepositNotSupported(why);
    if ('from' in spend) return this.outOfLending(pool, owner, spend, range);
    const [amountX, amountY] = await this.amounts(pool, owner, spend);
    if (amountX.lte(0) && amountY.lte(0)) {
      throw new NothingThere(`nothing of ${pool.x.symbol} or ${pool.y.symbol} to put in`);
    }
    return this.builderFor(pool).provide({ pool, owner, amountX, amountY, range });
  }

  async close(poolId: string, position: string, owner: string): Promise<BuiltTransaction> {
    const pool = await this.pool(poolId);
    return this.builderFor(pool).close({ position, owner }, pool);
  }

  async rebalance(
    poolId: string,
    position: string,
    owner: string,
    range: Range | null,
    carried: { amountX: Decimal; amountY: Decimal } | null = null,
  ): Promise<BuiltTransaction> {
    const pool = await this.pool(poolId);
    if (range) {
      const why = whyNotRange(range, pool);
      if (why) throw new DepositNotSupported(why);
    }
    return this.builderFor(pool).rebalance({ position, owner, range }, pool, carried);
  }

  private async outOfLending(
    pool: PairPool,
    owner: string,
    spend: { from: string; amount: Take },
    range: Range,
  ): Promise<BuiltTransaction> {
    if (!this.lending) throw new DepositNotSupported('taking money out of a pool is not wired here yet');
    const { name, token } = this.lending.tokenOf(spend.from);
    const paid = [pool.x, pool.y].find((one) => one.mint === token.mint);
    if (!paid) {
      throw new DepositNotSupported(
        `${name} pays out ${token.symbol}, and ${pool.name} takes ${pool.x.symbol} and ` +
          `${pool.y.symbol}: take it out as one of those first`,
      );
    }
    const out = await this.lending.takeOut(spend.from, spend.amount, owner);
    return {
      ...out.built,
      then: {
        action: 'provide',
        poolId: pairIdOf(pool.id),
        amount: out.arrived.toDecimalPlaces(paid.decimals, Decimal.ROUND_DOWN).toFixed(),
        payWith: paid.mint,
        belowPct: percentOf(range.below),
        abovePct: percentOf(range.above),
        holding: paid.symbol,
      },
    };
  }

  private builderFor(pool: PairPool): LiquidityBuilders {
    const build = this.builders[`${pool.id.network}:${pool.id.protocol}`];
    if (!build) {
      throw new DepositNotSupported(`${pool.id.protocol} liquidity is not wired here yet`);
    }
    return build;
  }

  private async amounts(
    pool: PairPool,
    owner: string,
    spend: Exclude<Spend, { from: string }>,
  ): Promise<[Decimal, Decimal]> {
    if ('amountX' in spend) {
      return [
        await this.spendable(pool.id.network, owner, pool.x, spend.amountX),
        await this.spendable(pool.id.network, owner, pool.y, spend.amountY),
      ];
    }
    const asked = spend.coin.trim();
    const is = (token: PairToken) =>
      token.mint === asked || token.symbol.toLowerCase() === asked.toLowerCase();
    const side = is(pool.x) ? 'x' : is(pool.y) ? 'y' : null;
    if (!side) {
      throw new DepositNotSupported(
        `${pool.name} takes ${pool.x.symbol} and ${pool.y.symbol}; pay with one of those`,
      );
    }
    const amount = await this.spendable(pool.id.network, owner, pool[side], spend.amount);
    return side === 'x' ? [amount, new Decimal(0)] : [new Decimal(0), amount];
  }

  /** How much of a token a wallet can put in: all of it less rent for SOL, or what was asked. */
  private async spendable(network: string, owner: string, token: PairToken, take: Take): Promise<Decimal> {
    if (take !== 'all' && take.lte(0)) return new Decimal(0);
    const read = this.holdings[network];
    const held = read ? await read(owner, token) : null;
    const places = (amount: Decimal) => amount.toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
    if (take === 'all') {
      if (held === null) {
        throw new DepositNotSupported(`what this wallet holds of ${token.symbol} could not be read`);
      }
      const all = token.mint === NATIVE ? held.minus(OPENING_SOL) : held;
      if (all.lte(0)) throw new NothingThere(`this wallet holds no ${token.symbol} to put in`);
      return places(all);
    }
    if (held === null) return places(take);
    const spent = fit(take, held);
    if ('short' in spent) {
      throw new NotEnoughHeld(
        `this wallet holds ${places(spent.held)} ${token.symbol} and this asks for ${take}`,
      );
    }
    return places(spent.amount);
  }
}
