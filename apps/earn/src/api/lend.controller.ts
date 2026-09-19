import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { LendDeposits } from '../application/deposits';
import { LendQueries } from '../application/queries';
import { ageMs, isStale } from '../domain/catalog';
import type { Clock } from '../application/refresher';
import type { Settings } from '../settings';
import { CLOCK, SETTINGS } from '../tokens';
import { encode, decode } from './cursors';
import { depositBody, pageSize, poolFilter, poolSelection } from './params';
import { builtDeposit, detail, meta, summary, tokenYield } from './presenters';

@Controller('v1/lend')
export class LendController {
  constructor(
    @Inject(LendQueries) private readonly queries: LendQueries,
    @Inject(LendDeposits) private readonly deposits: LendDeposits,
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
      data: builtDeposit(answer.built),
      meta: meta(answer.catalog, this.clock(), this.settings.staleAfterMs),
    };
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
