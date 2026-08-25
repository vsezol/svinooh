import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Portfolio, Position, Wallet } from '@prisma/client';
import type {
  Chain,
  HistoryDto,
  HistoryPointDto,
  HistoryRange,
  PortfolioDto,
  PositionCategory,
  PublicPortfolioDto,
  WalletDto,
  WalletSyncStatus,
} from '@svinooh/shared';
import { round2 } from '../common/util';
import { config } from '../config';
import { PrismaService } from '@svinooh/db';
import { detectChain } from '../scanners';
import { CacheService } from '../cache/cache.service';
import { SyncService } from '../sync/sync.service';

type WalletWithPositions = Wallet & { positions: Position[] };

const RANGES: Record<HistoryRange, { sinceMs: number | null; bucket: string | null }> = {
  '24h': { sinceMs: 24 * 3600e3, bucket: null }, // raw 5-minute points
  '7d': { sinceMs: 7 * 86400e3, bucket: '30 minutes' },
  '30d': { sinceMs: 30 * 86400e3, bucket: '2 hours' },
  all: { sinceMs: null, bucket: '6 hours' },
};

export function normalizeRange(raw: string | undefined): HistoryRange {
  return raw === '7d' || raw === '30d' || raw === 'all' ? raw : '24h';
}

/**
 * Removes wallet value dips that recover on their own — this is almost always a
 * source glitch (TronGrid without staking, a Chrome scrape returning $0) rather
 * than real movement. A drawdown deeper than 10% is treated as a candidate; if
 * the value returns almost exactly to its previous level (98%+) within the
 * window, it's an outlier and we hold the last good value (so the chart doesn't
 * jitter). Real movement doesn't bounce back that precisely and passes through
 * as-is.
 */
function smoothSeries(
  series: Array<{ t: number; v: number }>,
): Array<{ t: number; v: number }> {
  // We tell a glitch from real movement not by depth but by recovery: the price
  // dips and returns almost exactly to its previous value (the wallet data
  // recovered, nothing actually changed). Real movement doesn't bounce back
  // that precisely.
  const DROP = 0.9; // a drawdown deeper than 10% is an outlier candidate
  const RECOVER = 0.98; // if it returned to 98%+ of the previous value, it was an outlier
  const WINDOW = 90; // how far ahead we look for recovery (~1.5h at a 1-min sync)
  const out = series.map((s) => ({ t: s.t, v: s.v }));
  let lastGood = series[0].v;
  for (let i = 0; i < out.length; i++) {
    const cur = series[i].v;
    if (lastGood > 10 && cur < lastGood * DROP) {
      let recovers = false;
      const end = Math.min(series.length - 1, i + WINDOW);
      for (let j = i + 1; j <= end; j++) {
        if (series[j].v >= lastGood * RECOVER) {
          recovers = true;
          break;
        }
      }
      if (recovers) {
        out[i].v = lastGood; // spurious dip — hold the previous value
        continue;
      }
    }
    out[i].v = cur;
    lastGood = cur;
  }
  return out;
}

/** Downsamples the series to max points (always keeping the last one) */
function downsample(points: HistoryPointDto[], max: number): HistoryPointDto[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: HistoryPointDto[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Redis cache key for the assembled portfolio */
function cacheKey(slug: string): string {
  return `pf:${slug}`;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Leaderboard/search for the landing page: public portfolios ordered by
   * descending value. Portfolios are already open via their link — here they're
   * simply listed.
   */
  async listPublic(limit: number, query: string): Promise<PublicPortfolioDto[]> {
    const portfolios = await this.prisma.portfolio.findMany({
      include: { user: true, wallets: true },
    });

    const q = query.trim().toLowerCase().replace(/^@/, '');
    const rows = portfolios
      .map((portfolio) => {
        const known = portfolio.wallets.filter((w) => w.lastTotalUsd !== null);
        const totalUsd = round2(known.reduce((sum, w) => sum + (w.lastTotalUsd ?? 0), 0));
        const chains = [...new Set(portfolio.wallets.map((w) => w.chain as Chain))];
        const handle =
          portfolio.user.username ||
          [portfolio.user.firstName, portfolio.user.lastName].filter(Boolean).join(' ') ||
          'anon';
        return {
          slug: portfolio.slug,
          name: portfolio.name,
          handle,
          photoUrl: portfolio.user.photoUrl,
          totalUsd,
          walletCount: portfolio.wallets.length,
          chains,
        };
      })
      .filter((p) => p.walletCount > 0)
      .filter((p) => !q || p.handle.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.slug.includes(q))
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, Math.min(Math.max(limit, 1), 100));

    return rows;
  }

  /**
   * Public view: a portfolio is visible via its link without signing in. Served
   * from cache (Redis) — the owner-independent part is cached, and the isOwner
   * flag is applied on read. The cache is invalidated on owner edits; background
   * updates are picked up via TTL (config.cacheTtlSec).
   */
  async getBySlug(slug: string, userId: string | null): Promise<PortfolioDto> {
    const key = cacheKey(slug);
    let view = await this.cache.get<{ ownerUserId: string; dto: PortfolioDto }>(key);
    if (!view) {
      view = await this.buildView(slug);
      await this.cache.set(key, view, config.cacheTtlSec);
    }
    return { ...view.dto, isOwner: userId !== null && view.ownerUserId === userId };
  }

  private async buildView(slug: string): Promise<{ ownerUserId: string; dto: PortfolioDto }> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { user: true, wallets: { include: { positions: true } } },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const staleBefore = Date.now() - 3 * config.syncIntervalMin * 60_000;
    const wallets = portfolio.wallets
      .map((wallet) => this.toWalletDto(wallet, staleBefore))
      .sort(walletOrder);

    const updatedAt = wallets.reduce<string | null>(
      (latest, w) => (w.lastSyncedAt && (!latest || w.lastSyncedAt > latest) ? w.lastSyncedAt : latest),
      null,
    );

    const owner = portfolio.user;
    const dto: PortfolioDto = {
      slug: portfolio.slug,
      name: portfolio.name,
      owner: {
        name:
          [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.username || 'Anonymous',
        username: owner.username,
        photoUrl: owner.photoUrl,
      },
      totalUsd: round2(wallets.reduce((sum, w) => sum + (w.totalUsd ?? 0), 0)),
      wallets,
      isOwner: false,
      updatedAt,
      createdAt: portfolio.createdAt.toISOString(),
    };
    return { ownerUserId: portfolio.userId, dto };
  }

  async rename(slug: string, userId: string, nameRaw: string): Promise<{ name: string }> {
    const portfolio = await this.requireOwned(slug, userId);
    const name = String(nameRaw || '').trim().slice(0, 64);
    if (!name) throw new BadRequestException('Empty name');
    await this.prisma.portfolio.update({ where: { id: portfolio.id }, data: { name } });
    await this.cache.del(cacheKey(slug));
    return { name };
  }

  async addWallet(slug: string, userId: string, addressRaw: string): Promise<WalletDto> {
    const portfolio = await this.requireOwned(slug, userId);
    const address = String(addressRaw || '').trim();
    if (!address) throw new BadRequestException('Empty address');

    const chain = detectChain(address);
    if (!chain) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UNSUPPORTED_NETWORK',
        message: 'Could not detect the address network. Supported: BTC, EVM (0x…), SOL and TRON.',
      });
    }

    const existing = await this.prisma.wallet.findUnique({
      where: { portfolioId_address: { portfolioId: portfolio.id, address } },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        code: 'WALLET_EXISTS',
        message: 'This wallet is already in the portfolio',
      });
    }

    const wallet = await this.prisma.wallet.create({
      data: { portfolioId: portfolio.id, address, chain },
    });
    // The scan is async: the endpoint responds immediately (status=pending) and
    // the frontend polls. An EVM scan takes 20–40 seconds — we can't hold an
    // HTTP request open that long.
    void this.sync.scanWalletNow(wallet.id).catch(() => {});
    await this.cache.del(cacheKey(slug));
    return this.toWalletDto({ ...wallet, positions: [] }, 0);
  }

  async renameWallet(
    slug: string,
    userId: string,
    walletId: string,
    labelRaw: string,
  ): Promise<{ label: string | null }> {
    const portfolio = await this.requireOwned(slug, userId);
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    // An empty name resets to the default (null)
    const label = String(labelRaw || '').trim().slice(0, 40) || null;
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { label } });
    await this.cache.del(cacheKey(slug));
    return { label };
  }

  async removeWallet(slug: string, userId: string, walletId: string): Promise<{ ok: true }> {
    const portfolio = await this.requireOwned(slug, userId);
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    await this.prisma.wallet.delete({ where: { id: wallet.id } });
    await this.sync.snapshotPortfolio(portfolio.id);
    await this.cache.del(cacheKey(slug));
    return { ok: true };
  }

  async history(slug: string, range: HistoryRange): Promise<HistoryDto> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { wallets: { select: { id: true } } },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    const points = await this.reconstructPortfolioSeries(
      portfolio.wallets.map((w) => w.id),
      range,
    );
    return { range, points };
  }

  /**
   * Portfolio value series without the "jumps" caused by adding wallets: we
   * assemble it from wallet snapshots, where each wallet's value is carried back
   * across the whole range by its earliest known value. This way adding a wallet
   * doesn't look like a profit: change = Σ(current) − Σ(starting) = the sum of
   * real per-wallet profit, and change% = Σprofit / Σstarting.
   */
  private async reconstructPortfolioSeries(
    walletIds: string[],
    range: HistoryRange,
  ): Promise<HistoryPointDto[]> {
    if (!walletIds.length) return [];
    const { sinceMs } = RANGES[range];
    const since = sinceMs ? new Date(Date.now() - sinceMs) : null;
    const snaps = await this.prisma.walletSnapshot.findMany({
      where: { walletId: { in: walletIds }, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { walletId: true, createdAt: true, totalUsd: true },
    });
    if (!snaps.length) return [];

    // group snapshots by wallet (already sorted by time) and smooth each one —
    // removing short-lived glitch dips that recover on their own
    const byWallet = new Map<string, Array<{ t: number; v: number }>>();
    for (const s of snaps) {
      const arr = byWallet.get(s.walletId) ?? [];
      arr.push({ t: s.createdAt.getTime(), v: s.totalUsd });
      byWallet.set(s.walletId, arr);
    }

    // each wallet's starting point (carry-back) — the first smoothed value in the range
    const baseline = new Map<string, number>();
    const events: Array<{ t: number; id: string; v: number }> = [];
    for (const [id, series] of byWallet) {
      const smooth = smoothSeries(series);
      baseline.set(id, smooth[0].v);
      for (const p of smooth) events.push({ t: p.t, id, v: p.v });
    }

    // wallets with no snapshot in the range (never synced during the whole
    // period) — we take their last known value before the range starts, so the
    // total includes every wallet and the line isn't understated
    if (since) {
      const missing = walletIds.filter((id) => !baseline.has(id));
      if (missing.length) {
        const prior = await this.prisma.walletSnapshot.findMany({
          where: { walletId: { in: missing }, createdAt: { lt: since } },
          orderBy: { createdAt: 'desc' },
          select: { walletId: true, totalUsd: true },
        });
        for (const p of prior) if (!baseline.has(p.walletId)) baseline.set(p.walletId, p.totalUsd);
      }
    }

    // walk the events in time order, sum = Σ of the last known values
    // (initially = the starting ones, so a "new" wallet is present from t0)
    events.sort((a, b) => a.t - b.t);
    const current = new Map<string, number>(baseline);
    const points: HistoryPointDto[] = [];
    for (const e of events) {
      current.set(e.id, e.v);
      let sum = 0;
      for (const v of current.values()) sum += v;
      points.push({ t: new Date(e.t).toISOString(), usd: round2(sum) });
    }
    return downsample(points, 220);
  }

  async walletHistory(slug: string, walletId: string, range: HistoryRange): Promise<HistoryDto> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolio: { slug } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const points = await this.series('WalletSnapshot', 'walletId', wallet.id, range);
    return { range, points };
  }

  private async requireOwned(slug: string, userId: string): Promise<Portfolio> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { slug } });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    if (portfolio.userId !== userId) throw new ForbiddenException("This isn't your portfolio");
    return portfolio;
  }

  /**
   * Series for the charts. 24h uses raw points (step = sync interval); longer
   * ranges are aggregated into date_bin buckets on the Postgres side.
   */
  private async series(
    table: 'PortfolioSnapshot' | 'WalletSnapshot',
    fkColumn: 'portfolioId' | 'walletId',
    id: string,
    range: HistoryRange,
  ): Promise<HistoryPointDto[]> {
    const { sinceMs, bucket } = RANGES[range];
    const since = sinceMs ? new Date(Date.now() - sinceMs) : null;

    if (!bucket) {
      const where = { [fkColumn]: id, ...(since ? { createdAt: { gte: since } } : {}) };
      const rows =
        table === 'PortfolioSnapshot'
          ? await this.prisma.portfolioSnapshot.findMany({
              where: where as Prisma.PortfolioSnapshotWhereInput,
              orderBy: { createdAt: 'asc' },
              select: { createdAt: true, totalUsd: true },
            })
          : await this.prisma.walletSnapshot.findMany({
              where: where as Prisma.WalletSnapshotWhereInput,
              orderBy: { createdAt: 'asc' },
              select: { createdAt: true, totalUsd: true },
            });
      return rows.map((row) => ({ t: row.createdAt.toISOString(), usd: round2(row.totalUsd) }));
    }

    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; usd: number }>>(Prisma.sql`
      SELECT date_bin(${bucket}::interval, "createdAt", TIMESTAMP '2020-01-01') AS bucket,
             AVG("totalUsd")::float8 AS usd
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${Prisma.raw(`"${fkColumn}"`)} = ${id}
        ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    return rows.map((row) => ({ t: row.bucket.toISOString(), usd: round2(Number(row.usd)) }));
  }

  private toWalletDto(wallet: WalletWithPositions, staleBefore: number): WalletDto {
    const positions = [...wallet.positions]
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .map((p) => ({
        id: p.id,
        symbol: p.symbol,
        name: p.name,
        amount: p.amount,
        priceUsd: p.priceUsd,
        valueUsd: round2(p.valueUsd),
        platform: p.platform,
        category: p.category as PositionCategory,
      }));

    return {
      id: wallet.id,
      address: wallet.address,
      chain: wallet.chain as Chain,
      label: wallet.label,
      totalUsd: wallet.lastTotalUsd === null ? null : round2(wallet.lastTotalUsd),
      status: wallet.status as WalletSyncStatus,
      stale:
        wallet.status !== 'pending' &&
        (wallet.lastSyncedAt === null || wallet.lastSyncedAt.getTime() < staleBefore),
      lastSyncedAt: wallet.lastSyncedAt?.toISOString() ?? null,
      lastError: wallet.lastError,
      breakdown: (wallet.breakdown as Record<string, number> | null) ?? null,
      positions,
      unpriced: (wallet.unpriced as string[] | null) ?? undefined,
      createdAt: wallet.createdAt.toISOString(),
    };
  }
}

/** Wallets ordered by descending value; not-yet-scanned ones go to the end */
function walletOrder(a: WalletDto, b: WalletDto): number {
  if (a.totalUsd === null && b.totalUsd === null) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.totalUsd === null) return 1;
  if (b.totalUsd === null) return -1;
  return b.totalUsd - a.totalUsd;
}
