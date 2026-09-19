import type { Decimal } from 'decimal.js';
import type { Catalog } from '../domain/catalog';
import { belowMinimum, hasAccounts, type Deposit, type Landing } from '../domain/deposit';
import type { Pool } from '../domain/pool';
import { AmountBelowMinimum, DepositNotSupported } from './errors';
import type { LendQueries } from './queries';

export interface BuiltDeposit {
  transaction: string;
  feePayer: string;
  instructions: number;
  blockhash: string;
  lastValidBlockHeight: string;
}

export type BuildDeposit = (deposit: Deposit) => Promise<BuiltDeposit>;

export type LookUpLanding = (signature: string) => Promise<Landing>;

export interface DepositAnswer {
  built: BuiltDeposit;
  catalog: Catalog;
}

export const builderKey = (pool: Pool): string => `${pool.id.network}:${pool.id.protocol}`;

export class LendDeposits {
  constructor(
    private readonly queries: LendQueries,
    private readonly builders: Record<string, BuildDeposit>,
    private readonly landings: Record<string, LookUpLanding> = {},
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
    const deposit: Deposit = { pool, amount, owner };
    if (belowMinimum(deposit)) {
      throw new AmountBelowMinimum(
        `${pool.name} takes at least ${pool.deposit.minAmount} ${pool.token.symbol}`,
      );
    }
    return { built: await build(deposit), catalog };
  }
}
