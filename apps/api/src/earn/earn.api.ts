import { Inject, Injectable } from '@nestjs/common';
import { LendDeposits } from './application/deposits';
import { LendLiquidity } from './application/liquidity';
import { LendMoves } from './application/moves';
import type { Catalog } from './domain/catalog';
import {
  addressOf,
  depositBody,
  moveBody,
  networkOf,
  ownerOf,
  positionBody,
  provideBody,
  signatureOf,
  takeBody,
} from './api/params';
import { builtTransaction, effects, landing } from './api/presenters';

type Query = Record<string, string>;

/**
 * The door into earn for the rest of the api.
 *
 * Every write the deposits module used to ask of the earn service over HTTP
 * is a method here, taking the same raw body the route takes and answering
 * with the same wire shape the route answers, so the deposits module reads
 * exactly what it read before — just without the network in between. The
 * controllers are the same methods with a route on top.
 */
@Injectable()
export class EarnApi {
  constructor(
    @Inject(LendDeposits) private readonly deposits: LendDeposits,
    @Inject(LendMoves) private readonly moves: LendMoves,
    @Inject(LendLiquidity) private readonly liquidity: LendLiquidity,
  ) {}

  async deposit(poolId: string, body: unknown): Promise<Built> {
    const { amount, owner } = depositBody(body);
    const answer = await this.deposits.build(poolId, amount, owner);
    return { data: builtTransaction(answer.built), catalog: answer.catalog };
  }

  async withdraw(poolId: string, body: unknown): Promise<Built> {
    const { take, owner } = takeBody(body);
    const answer = await this.moves.withdraw(poolId, take, owner);
    return { data: builtTransaction(answer.built), catalog: answer.catalog };
  }

  async move(body: unknown): Promise<Built> {
    const { from, to, take, owner } = moveBody(body);
    const answer = await this.moves.move(from, to, take, owner);
    return { data: builtTransaction(answer.built), catalog: answer.catalog };
  }

  async provide(poolId: string, body: unknown): Promise<WireTransaction> {
    const { owner, spend, range } = provideBody(body);
    return builtTransaction(await this.liquidity.provide(poolId, owner, spend, range));
  }

  async close(poolId: string, position: string, body: unknown): Promise<WireTransaction> {
    const { owner } = positionBody(body);
    return builtTransaction(await this.liquidity.close(poolId, addressOf(position, 'position'), owner));
  }

  async rebalance(poolId: string, position: string, body: unknown): Promise<WireTransaction> {
    const { owner, range, carried } = positionBody(body);
    return builtTransaction(
      await this.liquidity.rebalance(poolId, addressOf(position, 'position'), owner, range, carried),
    );
  }

  /** Whether a signed transaction is on the chain: `network` in the query */
  async landing(signature: string, query: Query): Promise<WireLanding> {
    return landing(await this.deposits.landing(networkOf(query), signatureOf(signature)));
  }

  /** What a landed transaction left in the wallet: `network` and `owner` in the query */
  async effects(signature: string, query: Query): Promise<WireEffects | null> {
    return effects(await this.deposits.after(networkOf(query), signatureOf(signature), ownerOf(query)));
  }
}

export type WireTransaction = ReturnType<typeof builtTransaction>;
export type WireLanding = ReturnType<typeof landing>;
export type WireEffects = NonNullable<ReturnType<typeof effects>>;

interface Built {
  data: WireTransaction;
  /** The catalog the pool was read from — the controllers put it in `meta` */
  catalog: Catalog;
}
