import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { LendCoins } from '../application/coins';
import { LendDeposits } from '../application/deposits';
import { LendMoves } from '../application/moves';
import { LendQueries } from '../application/queries';
import { ageMs, isStale } from '../domain/catalog';
import type { Clock } from '../application/refresher';
import type { Settings } from '../settings';
import { CLOCK, SETTINGS } from '../tokens';
import { encode, decode } from './cursors';
import {
  coinOf,
  depositBody,
  moveBody,
  networkOf,
  ownerOf,
  ownersOf,
  pageSize,
  poolFilter,
  poolSelection,
  signatureOf,
  takeBody,
} from './params';
import {
  builtTransaction,
  chainMeta,
  coin,
  detail,
  holding,
  landing,
  meta,
  position,
  summary,
  tokenYield,
} from './presenters';

@Controller('v1/lend')
export class LendController {
  constructor(
    @Inject(LendQueries) private readonly queries: LendQueries,
    @Inject(LendDeposits) private readonly deposits: LendDeposits,
    @Inject(LendMoves) private readonly moves: LendMoves,
    @Inject(LendCoins) private readonly coins: LendCoins,
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('pools')
  listPools(@Query() query: Record<string, string>) {
    const selection = poolSelection(query);
    const limit = pageSize(query, this.settings.defaultPageSize, this.settings.maxPageSize);
    const cursor = query.cursor ? decode(query.cursor) : null;
    const answer = this.queries.listPools(selection, limit, cursor);
    return {
      data: answer.page.items.map(summary),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs, {
        count: answer.page.items.length,
        total: answer.page.total,
        next_cursor: answer.resume === null ? null : encode(answer.resume),
      }),
    };
  }

  @Get('pools/:poolId')
  getPool(@Param('poolId') poolId: string) {
    const answer = this.queries.getPool(poolId);
    return {
      data: detail(answer.pool),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs),
    };
  }

  @Post('pools/:poolId/deposit')
  @HttpCode(200)
  async buildDeposit(@Param('poolId') poolId: string, @Body() body: unknown) {
    const { amount, owner } = depositBody(body);
    const answer = await this.deposits.build(poolId, amount, owner);
    return {
      data: builtTransaction(answer.built),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs),
    };
  }

  @Get('positions')
  async listPositions(@Query() query: Record<string, string>) {
    const answer = await this.moves.positions(networkOf(query), ownerOf(query));
    return {
      data: answer.positions.map(position),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs, {
        count: answer.positions.length,
        total: answer.positions.length,
      }),
    };
  }

  @Post('pools/:poolId/withdraw')
  @HttpCode(200)
  async buildWithdrawal(@Param('poolId') poolId: string, @Body() body: unknown) {
    const { take, owner } = takeBody(body);
    const answer = await this.moves.withdraw(poolId, take, owner);
    return {
      data: builtTransaction(answer.built),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs),
    };
  }

  @Post('moves')
  @HttpCode(200)
  async buildMove(@Body() body: unknown) {
    const { from, to, take, owner } = moveBody(body);
    const answer = await this.moves.move(from, to, take, owner);
    return {
      data: builtTransaction(answer.built),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs),
    };
  }

  @Get('coins')
  async findCoin(@Query() query: Record<string, string | string[]>) {
    const found = await this.coins.find(networkOf(query), coinOf(query), ownersOf(query));
    return { data: coin(found), meta: chainMeta(this.clock()) };
  }

  @Get('holdings')
  async holding(@Query() query: Record<string, string>) {
    const found = await this.coins.held(networkOf(query), coinOf(query), ownerOf(query));
    return { data: holding(found), meta: chainMeta(this.clock()) };
  }

  @Get('deposits/:signature')
  async depositLanding(
    @Param('signature') signature: string,
    @Query() query: Record<string, string>,
  ) {
    const seen = await this.deposits.landing(networkOf(query), signatureOf(signature));
    return { data: landing(seen), meta: chainMeta(this.clock()) };
  }

  @Get('tokens')
  listTokens(@Query() query: Record<string, string>) {
    const answer = this.queries.listTokens(poolFilter(query));
    return {
      data: answer.tokens.map(tokenYield),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs, {
        count: answer.tokens.length,
        total: answer.tokens.length,
      }),
    };
  }
}

export { ageMs, isStale };
