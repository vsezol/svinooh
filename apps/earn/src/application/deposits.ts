import type { Decimal } from 'decimal.js';
import type { Catalog } from '../domain/catalog';
import {
  belowMinimum,
  fitToHoldings,
  hasAccounts,
  type Deposit,
  type Landing,
} from '../domain/deposit';
import type { Pool } from '../domain/pool';
import { AmountBelowMinimum, DepositNotSupported, NotEnoughHeld } from './errors';
import type { LendQueries } from './queries';

export interface BuiltTransaction {
  transaction: string;
  feePayer: string;
  instructions: number;
  blockhash: string;
  lastValidBlockHeight: string;
  /**
   * What to sign once this has landed, when one transaction could not hold it
   * all: a deposit of `amount` into `poolId`, the second half of a move.
   */
  then?: { poolId: string; amount: string };
}

export type BuildDeposit = (deposit: Deposit) => Promise<BuiltTransaction>;

export type LookUpLanding = (signature: string) => Promise<Landing>;

/** What the owner holds of the pool's token, or null when nobody could look. */
export type ReadHoldings = (owner: string, pool: Pool) => Promise<Decimal | null>;

export interface DepositAnswer {
  built: BuiltTransaction;
  catalog: Catalog;
}

export const builderKey = (pool: Pool): string => `${pool.id.network}:${pool.id.protocol}`;

export class LendDeposits {
  constructor(
    private readonly queries: LendQueries,
    private readonly builders: Record<string, BuildDeposit>,
    private readonly landings: Record<string, LookUpLanding> = {},
    private readonly holdings: Record<string, ReadHoldings> = {},
  ) {}

  landing(network: string, signature: string): Promise<Landing> {
    const lookUp = this.landings[network];
    if (!lookUp) {
      throw new DepositNotSupported(`${network} deposits are not followed here yet`);
    }
    return lookUp(signature);
  }

  async build(poolId: string, amount: Decimal, owner: string): Promise<DepositAnswer> {
    const { pool, catalog } = this.queries.getPool(poolId);
    const build = this.builders[builderKey(pool)];
    if (!build) {
      throw new DepositNotSupported(
        `${pool.id.protocol} on ${pool.id.network} is not wired for deposits here yet`,
      );
    }
    if (!hasAccounts(pool)) {
      throw new DepositNotSupported(`the catalog has no deposit accounts for ${pool.name}`);
    }
    const deposit: Deposit = { pool, amount: await this.affordable(pool, amount, owner), owner };
    if (belowMinimum(deposit)) {
      throw new AmountBelowMinimum(
        `${pool.name} takes at least ${pool.deposit.minAmount} ${pool.token.symbol}`,
      );
    }
    return { built: await build(deposit), catalog };
  }

  private async affordable(pool: Pool, amount: Decimal, owner: string): Promise<Decimal> {
    const read = this.holdings[pool.id.network];
    if (!read) return amount;
    // A chain nobody could reach is not evidence of an empty wallet: refuse on
    // what a balance says, never on the silence where one should have been.
    const held = await read(owner, pool);
    if (held === null) return amount;
    const fit = fitToHoldings({ pool, amount, owner }, held);
    if ('short' in fit) {
      throw new NotEnoughHeld(
        `this wallet holds ${fit.held} ${pool.token.symbol} and the deposit asks for ${amount}`,
      );
    }
    return fit.amount;
  }
}
