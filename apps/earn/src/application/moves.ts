import { Decimal } from 'decimal.js';
import type { Catalog } from '../domain/catalog';
import { hasAccounts } from '../domain/deposit';
import type { Pool } from '../domain/pool';
import {
  burnFor,
  whyNotMove,
  type Move,
  type Position,
  type Take,
  type Withdrawal,
} from '../domain/withdrawal';
import { builderKey, type BuiltTransaction } from './deposits';
import { DepositNotSupported, MoveNotSupported, NotEnoughHeld, NothingThere } from './errors';
import type { LendQueries } from './queries';

/** What this owner holds in any of these pools; pools they hold nothing in are left out. */
export type ReadPositions = (owner: string, pools: Pool[]) => Promise<Position[]>;

export type BuildWithdrawal = (withdrawal: Withdrawal) => Promise<BuiltTransaction>;

export type BuildMove = (move: Move) => Promise<BuiltTransaction>;

export interface PositionsAnswer {
  positions: Position[];
  catalog: Catalog;
}

export interface BuiltAnswer {
  built: BuiltTransaction;
  catalog: Catalog;
}

/** Taking money out of a pool, and taking it out of one pool into another. */
export class LendMoves {
  constructor(
    private readonly queries: LendQueries,
    private readonly readers: Record<string, ReadPositions>,
    private readonly withdrawals: Record<string, BuildWithdrawal>,
    private readonly moves: Record<string, BuildMove>,
  ) {}

  async positions(network: string, owner: string): Promise<PositionsAnswer> {
    const read = this.readerFor(network);
    const { pools, catalog } = this.queries.onNetwork(network);
    return { positions: await read(owner, pools), catalog };
  }

  async withdraw(poolId: string, take: Take, owner: string): Promise<BuiltAnswer> {
    const { pool, catalog } = this.queries.getPool(poolId);
    const build = this.withdrawals[builderKey(pool)];
    if (!build) {
      throw new DepositNotSupported(
        `${pool.id.protocol} on ${pool.id.network} is not wired for withdrawals here yet`,
      );
    }
    const burn = await this.burning(pool, take, owner);
    return { built: await build({ pool, owner, ...burn }), catalog };
  }

  async move(fromId: string, toId: string, take: Take, owner: string): Promise<BuiltAnswer> {
    const { pool: from, catalog } = this.queries.getPool(fromId);
    const { pool: to } = this.queries.getPool(toId);
    const why = whyNotMove(from, to);
    if (why) throw new MoveNotSupported(why);
    if (!hasAccounts(to)) {
      throw new DepositNotSupported(`the catalog has no deposit accounts for ${to.name}`);
    }
    const build = this.moves[builderKey(from)];
    if (!build || builderKey(from) !== builderKey(to)) {
      throw new MoveNotSupported(
        `moving from ${from.id.protocol} to ${to.id.protocol} is not wired here yet`,
      );
    }
    const burn = await this.burning(from, take, owner);
    return { built: await build({ from, to, owner, ...burn }), catalog };
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

  private readerFor(network: string): ReadPositions {
    const read = this.readers[network];
    if (!read) throw new DepositNotSupported(`${network} positions are not read here yet`);
    return read;
  }
}
