import type { Decimal } from 'decimal.js';
import type { Catalog } from '../domain/catalog';
import {
  belowMinimum,
  fitToHoldings,
  hasAccounts,
  type Deposit,
  type Landing,
} from '../domain/deposit';
import type { Effects } from '../domain/effects';
import type { Pool, Token } from '../domain/pool';
import { AmountBelowMinimum, DepositNotSupported, NotEnoughHeld } from './errors';
import type { LendQueries } from './queries';

export interface BuiltTransaction {
  transaction: string;
  feePayer: string;
  instructions: number;
  blockhash: string;
  lastValidBlockHeight: string;
  /** What to build and sign once this has landed, when one transaction could not hold it all. */
  then?: Then;
}

/**
 * The next step of something one transaction could not hold, built only once
 * the step before it has landed: `amount` of what that step left in the
 * wallet, into `poolId` or — when it ends in the wallet — as `receiveAs`.
 * `payWith` is the coin it spends when that is not the pool's own token, so
 * the step swaps on the way; without it the step is a plain deposit.
 * `holding` is what the money sits in meanwhile, to say so should the next
 * step never happen.
 *
 * Liquidity for a pair says its `action`: `provide` places `amountX` and
 * `amountY` in `poolId` across the range `belowPct`/`abovePct` from the
 * price; `close` and `rebalance` go on with `position` where the step before
 * left off.
 */
export interface Then {
  action?: 'provide' | 'close' | 'rebalance';
  poolId?: string;
  amount?: string;
  payWith?: string;
  receiveAs?: string;
  position?: string;
  amountX?: string;
  amountY?: string;
  belowPct?: string;
  abovePct?: string;
  holding: string;
}

export type BuildDeposit = (deposit: Deposit) => Promise<BuiltTransaction>;

export type LookUpLanding = (signature: string) => Promise<Landing>;

export type ReadEffects = (signature: string, owner: string, pools: Pool[]) => Promise<Effects | null>;

/** What the owner holds of a token, or null when nobody could look. */
export type ReadHoldings = (owner: string, token: Token) => Promise<Decimal | null>;

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
    private readonly effects: Record<string, ReadEffects> = {},
  ) {}

  landing(network: string, signature: string): Promise<Landing> {
    const lookUp = this.landings[network];
    if (!lookUp) {
      throw new DepositNotSupported(`${network} deposits are not followed here yet`);
    }
    return lookUp(signature);
  }

  async after(network: string, signature: string, owner: string): Promise<Effects | null> {
    const read = this.effects[network];
    if (!read) {
      throw new DepositNotSupported(`what ${network} transactions leave behind is not read here yet`);
    }
    const landing = await this.landing(network, signature);
    if (landing.status !== 'landed') return null;
    return read(signature, owner, this.queries.onNetwork(network).pools);
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
    const held = await read(owner, pool.token);
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
