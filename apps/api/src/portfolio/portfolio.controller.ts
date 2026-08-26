import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId, OptionalAuthGuard, RequiredAuthGuard } from '@svinooh/common';
import { normalizeRange, PortfolioService } from './portfolio.service';

@Controller('portfolios')
export class PortfolioController {
  constructor(private readonly portfolios: PortfolioService) {}

  // IMPORTANT: the literal route is declared before ':slug', otherwise Nest
  // would match "public" as a slug
  @Get('public')
  listPublic(@Query('limit') limit?: string, @Query('q') q?: string) {
    return this.portfolios.listPublic(Number(limit) || 20, q ?? '');
  }

  /**
   * Open a wallet address as a portfolio, creating an ownerless one if nobody is
   * tracking it yet. No sign-in: the result belongs to nobody and carries no
   * user data.
   */
  @Post('anonymous')
  trackAddress(@Body() body: { address?: string }) {
    return this.portfolios.findOrCreateAnonymous(body?.address ?? '');
  }

  @Get(':slug')
  @UseGuards(OptionalAuthGuard)
  get(@Param('slug') slug: string, @CurrentUserId() userId: string | null) {
    return this.portfolios.getBySlug(slug, userId);
  }

  @Patch(':slug')
  @UseGuards(RequiredAuthGuard)
  rename(
    @Param('slug') slug: string,
    @CurrentUserId() userId: string,
    @Body() body: { name?: string },
  ) {
    return this.portfolios.rename(slug, userId, body?.name ?? '');
  }

  /** Take over a portfolio that belongs to nobody */
  @Post(':slug/claim')
  @UseGuards(RequiredAuthGuard)
  claim(@Param('slug') slug: string, @CurrentUserId() userId: string) {
    return this.portfolios.claim(slug, userId);
  }

  @Patch(':slug/visibility')
  @UseGuards(RequiredAuthGuard)
  setVisibility(
    @Param('slug') slug: string,
    @CurrentUserId() userId: string,
    @Body() body: { isPublic?: boolean },
  ) {
    return this.portfolios.setVisibility(slug, userId, body?.isPublic === true);
  }

  @Get(':slug/history')
  history(@Param('slug') slug: string, @Query('range') range?: string) {
    return this.portfolios.history(slug, normalizeRange(range));
  }

  // Optional auth: an anonymous portfolio accepts wallets from anyone, an owned
  // one only from its owner — the service decides which applies
  @Post(':slug/wallets')
  @UseGuards(OptionalAuthGuard)
  addWallet(
    @Param('slug') slug: string,
    @CurrentUserId() userId: string | null,
    @Body() body: { address?: string },
  ) {
    return this.portfolios.addWallet(slug, userId, body?.address ?? '');
  }

  @Patch(':slug/wallets/:walletId')
  @UseGuards(RequiredAuthGuard)
  renameWallet(
    @Param('slug') slug: string,
    @CurrentUserId() userId: string,
    @Param('walletId') walletId: string,
    @Body() body: { label?: string },
  ) {
    return this.portfolios.renameWallet(slug, userId, walletId, body?.label ?? '');
  }

  @Delete(':slug/wallets/:walletId')
  @UseGuards(RequiredAuthGuard)
  removeWallet(
    @Param('slug') slug: string,
    @CurrentUserId() userId: string,
    @Param('walletId') walletId: string,
  ) {
    return this.portfolios.removeWallet(slug, userId, walletId);
  }

  @Get(':slug/wallets/:walletId/history')
  walletHistory(
    @Param('slug') slug: string,
    @Param('walletId') walletId: string,
    @Query('range') range?: string,
  ) {
    return this.portfolios.walletHistory(slug, walletId, normalizeRange(range));
  }
}
