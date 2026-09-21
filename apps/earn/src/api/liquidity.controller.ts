import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { LendLiquidity } from '../application/liquidity';
import type { Clock } from '../application/refresher';
import { CLOCK } from '../tokens';
import {
  addressOf,
  networkOf,
  ownerOf,
  pairOf,
  positionBody,
  provideBody,
  rangeOf,
} from './params';
import { builtTransaction, chainMeta, liquidityPosition, pairFit, pairPool } from './presenters';

/**
 * Liquidity for a pair: the pools that pair two tokens, and what an owner has
 * placed in them. Read straight from the protocol, not from the lending
 * catalog: a pair pool's price and fees move by the minute, so `meta` says
 * when this answer was taken rather than which catalog it came from.
 */
@Controller('v1/liquidity')
export class LiquidityController {
  constructor(
    @Inject(LendLiquidity) private readonly liquidity: LendLiquidity,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('pools')
  async listPools(@Query() query: Record<string, string>) {
    const [first, second] = pairOf(query);
    const fits = await this.liquidity.pools(networkOf(query), first, second, rangeOf(query) ?? undefined);
    const meta = chainMeta(this.clock());
    return { data: fits.map(pairFit), meta: { ...meta, count: fits.length, total: fits.length } };
  }

  @Get('pools/:poolId')
  async getPool(@Param('poolId') poolId: string) {
    return { data: pairPool(await this.liquidity.pool(poolId)), meta: chainMeta(this.clock()) };
  }

  @Get('positions')
  async listPositions(@Query() query: Record<string, string>) {
    const held = await this.liquidity.positions(networkOf(query), ownerOf(query));
    const meta = chainMeta(this.clock());
    return { data: held.map(liquidityPosition), meta: { ...meta, count: held.length, total: held.length } };
  }

  @Post('pools/:poolId/provide')
  @HttpCode(200)
  async provide(@Param('poolId') poolId: string, @Body() body: unknown) {
    const { owner, spend, range } = provideBody(body);
    const built = await this.liquidity.provide(poolId, owner, spend, range);
    return { data: builtTransaction(built), meta: chainMeta(this.clock()) };
  }

  @Post('pools/:poolId/positions/:position/close')
  @HttpCode(200)
  async close(
    @Param('poolId') poolId: string,
    @Param('position') position: string,
    @Body() body: unknown,
  ) {
    const { owner } = positionBody(body);
    const built = await this.liquidity.close(poolId, addressOf(position, 'position'), owner);
    return { data: builtTransaction(built), meta: chainMeta(this.clock()) };
  }

  @Post('pools/:poolId/positions/:position/rebalance')
  @HttpCode(200)
  async rebalance(
    @Param('poolId') poolId: string,
    @Param('position') position: string,
    @Body() body: unknown,
  ) {
    const { owner, range, carried } = positionBody(body);
    const built = await this.liquidity.rebalance(
      poolId,
      addressOf(position, 'position'),
      owner,
      range,
      carried,
    );
    return { data: builtTransaction(built), meta: chainMeta(this.clock()) };
  }
}
