import { Decimal } from 'decimal.js';
import type { Catalog } from '../domain/catalog';
import { fit, hasAccounts } from '../domain/deposit';
import { whyNotMove, type Coin, type Move, type Place, type Source } from '../domain/move';
import type { Pool } from '../domain/pool';
import { burnFor, type Position, type Take, type Withdrawal } from '../domain/withdrawal';
import { LendCoins } from './coins';
import { builderKey, type BuiltTransaction, type ReadHoldings } from './deposits';
import { DepositNotSupported, MoveNotSupported, NotEnoughHeld, NothingThere } from './errors';
import type { LendQueries } from './queries';

/** What this owner holds in any of these pools; pools they hold nothing in are left out. */
export type ReadPositions = (owner: string, pools: Pool[]) => Promise<Position[]>;

export type BuildWithdrawal = (withdrawal: Withdrawal) => Promise<BuiltTransaction>;

export type BuildMove = (move: Move) => Promise<BuiltTransaction>;

/** One end of a move as it is asked for: a pool by its id, or a coin by its mint or ticker. */
export type Named = { pool: string } | { coin: string };

export interface PositionsAnswer {
  positions: Position[];
  catalog: Catalog;
}

export interface BuiltAnswer {
  built: BuiltTransaction;
  catalog: Catalog;
}

/** Taking money out of a pool, and taking it from one place into another. */
export class LendMoves {
  constructor(
    private readonly queries: LendQueries,
    private readonly readers: Record<string, ReadPositions>,
    private readonly withdrawals: Record<string, BuildWithdrawal>,
    private readonly moves: Record<string, BuildMove>,
    private readonly coins: LendCoins = new LendCoins(queries),
    private readonly holdings: Record<string, ReadHoldings> = {},
  ) {}

  async positions(network: string, owner: string): Promise<PositionsAnswer> {
    const read = this.readerFor(network);
    const { pools, catalog } = this.queries.onNetwork(network);
    return { positions: await read(owner, pools), catalog };
  }

  async withdraw(poolId: string, take: Take, owner: string): Promise<BuiltAnswer> {
    const { pool, catalog } = this.queries.getPool(poolId);
    return { built: await this.withdrawal(pool, take, owner), catalog };
  }

  /**
   * Money from one place into another: pool to pool, a pool out into the
   * wallet as another coin, a coin in the wallet into a pool of another, or
   * one coin for another. Out of a pool into its own token is a withdrawal,
   * and is built as one.
   */
  async move(from: Named, to: Named, take: Take, owner: string): Promise<BuiltAnswer> {
    const network = this.networkOf(from, to);
    const origin = await this.place(network, from, owner);
    const target = await this.place(network, to, owner);
    const why = whyNotMove(origin, target);
    if (why) throw new MoveNotSupported(why);
    if ('pool' in target && !hasAccounts(target.pool)) {
      throw new DepositNotSupported(`the catalog has no deposit accounts for ${target.pool.name}`);
    }
    const { catalog } = this.queries.onNetwork(network);
    if ('pool' in origin && 'coin' in target && origin.pool.token.mint === target.coin.mint) {
      return { built: await this.withdrawal(origin.pool, take, owner), catalog };
    }
    // A move with a pool at either end is built by that pool's protocol; one
    // with none — a coin swapped for another in the wallet — by the network's swap.
    const pools = [origin, target].flatMap((one) => ('pool' in one ? [one.pool] : []));
    const keys = new Set(pools.map(builderKey));
    const build = this.moves[pools.length ? builderKey(pools[0]) : network];
    if (!build || keys.size > 1) {
      const protocols = pools.map((pool) => pool.id.protocol).join(' to ') || `${network} swaps`;
      throw new MoveNotSupported(`moving from ${protocols} is not wired here yet`);
    }
    const source: Source =
      'pool' in origin
        ? { pool: origin.pool, ...(await this.burning(origin.pool, take, owner)) }
        : { coin: origin.coin, amount: await this.spendable(network, origin.coin, take, owner) };
    return { built: await build({ from: source, to: target, owner }), catalog };
  }

  private async withdrawal(pool: Pool, take: Take, owner: string): Promise<BuiltTransaction> {
    const build = this.withdrawals[builderKey(pool)];
    if (!build) {
      throw new DepositNotSupported(
        `${pool.id.protocol} on ${pool.id.network} is not wired for withdrawals here yet`,
      );
    }
    const burn = await this.burning(pool, take, owner);
    return build({ pool, owner, ...burn });
  }

  private networkOf(from: Named, to: Named): string {
    const pool = 'pool' in from ? from.pool : 'pool' in to ? to.pool : null;
    return pool ? this.queries.getPool(pool).pool.id.network : 'sol';
  }

  private async place(network: string, named: Named, owner: string): Promise<Place> {
    if ('pool' in named) return { pool: this.queries.getPool(named.pool).pool };
    return { coin: await this.coins.find(network, named.coin, [owner]) };
  }

  private async burning(pool: Pool, take: Take, owner: string) {
    const [position] = await this.readerFor(pool.id.network)(owner, [pool]);
    if (!position || position.shares.isZero()) {
      throw new NothingThere(`this wallet has nothing in ${pool.name}`);
    }
    const burn = burnFor(position, take);
    if ('short' in burn) {
      const held = burn.held.toDecimalPlaces(pool.token.decimals ?? 6, Decimal.ROUND_DOWN);
      throw new NotEnoughHeld(
        `this wallet has ${held} ${pool.token.symbol} in ${pool.name} ` +
          `and the withdrawal asks for ${take}`,
      );
    }
    return burn;
  }

  /**
   * How much of a coin in the wallet a move spends. A chain nobody could
   * reach is not an empty wallet, so only a balance that was read refuses —
   * and "all" needs one, there being nothing else to say what all is.
   */
  private async spendable(
    network: string,
    coin: Coin,
    take: Take,
    owner: string,
  ): Promise<Decimal> {
    const read = this.holdings[network];
    const held = read ? await read(owner, coin) : null;
    if (take === 'all') {
      if (held === null) {
        throw new DepositNotSupported(`what this wallet holds of ${coin.symbol} could not be read`);
      }
      if (held.lessThanOrEqualTo(0)) throw new NothingThere(`this wallet holds no ${coin.symbol}`);
      return held.toDecimalPlaces(coin.decimals, Decimal.ROUND_DOWN);
    }
    if (held === null) return take;
    const spent = fit(take, held);
    if ('short' in spent) {
      throw new NotEnoughHeld(
        `this wallet holds ${spent.held.toDecimalPlaces(coin.decimals, Decimal.ROUND_DOWN)} ` +
          `${coin.symbol} and the move asks for ${take}`,
      );
    }
    return spent.amount.toDecimalPlaces(coin.decimals, Decimal.ROUND_DOWN);
  }

  private readerFor(network: string): ReadPositions {
    const read = this.readers[network];
    if (!read) throw new DepositNotSupported(`${network} positions are not read here yet`);
    return read;
  }
}
