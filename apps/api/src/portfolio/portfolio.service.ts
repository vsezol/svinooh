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
  PortfolioOwnerDto,
  PortfolioVisibility,
  PositionCategory,
  PositionRange,
  PositionTokenDto,
  PublicPortfolioDto,
  WalletDto,
  WalletSyncStatus,
} from '@svinooh/shared';
import { randomSlug, round2, shortAddress } from '../common/util';
import { config } from '../config';
import { PrismaService } from '@svinooh/db';
import { detectChain } from '../scanners/detect';
import { CacheService } from '../cache/cache.service';

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

function unsupportedNetwork(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'UNSUPPORTED_NETWORK',
    message: 'Could not detect the address network. Supported: BTC, EVM (0x…), SOL and TRON.',
  });
}

/**
 * What we keep in Redis. `dto` is the PUBLIC view and nothing else — the owner's
 * profile and their wallet labels sit beside it and are only ever merged in for
 * a request authenticated as the owner. Keeping them out of `dto` means a cache
 * hit cannot accidentally hand someone else's identity to a stranger.
 */
interface CachedView {
  ownerUserId: string | null;
  owner: PortfolioOwnerDto | null;
  labels: Record<string, string | null>;
  dto: PortfolioDto;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The landing list and search. Only two kinds of portfolio are listed:
   * anonymous ones (no owner at all) and ones an owner explicitly published.
   * Anything else stays off this list entirely — a private portfolio must not be
   * discoverable, only reachable by its link.
   *
   * Nothing about a person is returned here, by construction: the query never
   * loads a User, so there is no handle or photo to leak even by accident.
   * Search matches the portfolio name, its slug and its wallet addresses —
   * addresses being how someone looks up a wallet they care about.
   */
  async listPublic(limit: number, query: string): Promise<PublicPortfolioDto[]> {
    const portfolios = await this.prisma.portfolio.findMany({
      where: { OR: [{ owner: null }, { owner: { isPublic: true } }] },
      include: { owner: { select: { portfolioId: true } }, wallets: true },
    });

    const q = query.trim().toLowerCase().replace(/^@/, '');
    return portfolios
      .map((portfolio) => {
        const known = portfolio.wallets.filter((w) => w.lastTotalUsd !== null);
        return {
          slug: portfolio.slug,
          name: portfolio.name,
          totalUsd: round2(known.reduce((sum, w) => sum + (w.lastTotalUsd ?? 0), 0)),
          walletCount: portfolio.wallets.length,
          chains: [...new Set(portfolio.wallets.map((w) => w.chain as Chain))],
          anonymous: portfolio.owner === null,
          addresses: portfolio.wallets.map((w) => w.address.toLowerCase()),
        };
      })
      .filter((p) => p.walletCount > 0)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.slug.includes(q) ||
          p.addresses.some((address) => address.includes(q)),
      )
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map(({ addresses: _addresses, ...row }) => row);
  }

  /**
   * Look up a wallet address as a portfolio, creating one if it isn't tracked
   * yet. This is what the landing search offers when nothing matched: the result
   * is a portfolio that belongs to NOBODY — public, searchable, with no user
   * attached — so it can be shared and revisited without involving an account.
   *
   * Re-running it for the same address returns the existing anonymous portfolio
   * rather than piling up duplicates.
   */
  async findOrCreateAnonymous(addressRaw: string): Promise<{ slug: string }> {
    const raw = String(addressRaw || '').trim();
    const chain = detectChain(raw);
    if (!chain) throw unsupportedNetwork();
    // EVM addresses are case-insensitive, so the same wallet typed with and
    // without checksum casing must not spawn two portfolios. Base58 chains are
    // left alone — there case is part of the address.
    const address = chain === 'EVM' ? raw.toLowerCase() : raw;

    // An existing anonymous portfolio for exactly this one wallet, nothing else
    const existing = await this.prisma.portfolio.findFirst({
      where: { owner: null, wallets: { some: { address }, every: { address } } },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return { slug: existing.slug };

    const portfolio = await this.prisma.portfolio.create({
      data: {
        slug: randomSlug(),
        // An address is public chain data — unlike a handle, it identifies the
        // wallet rather than the person, and it is what someone searched for
        name: shortAddress(address),
        wallets: { create: { address, chain } },
      },
      include: { wallets: true },
    });
    this.requestScan(portfolio.wallets[0].id);
    return { slug: portfolio.slug };
  }

  /**
   * Public view: a portfolio is visible via its link without signing in. Served
   * from cache (Redis) — the owner-independent part is cached, and the isOwner
   * flag is applied on read. The cache is invalidated on owner edits; background
   * updates are picked up via TTL (config.cacheTtlSec).
   */
  async getBySlug(slug: string, userId: string | null): Promise<PortfolioDto> {
    const key = cacheKey(slug);
    let view = await this.cache.get<CachedView>(key);
    if (!view) {
      view = await this.buildView(slug);
      await this.cache.set(key, view, config.cacheTtlSec);
    }
    const isOwner = userId !== null && view.ownerUserId === userId;
    // The cached view is the PUBLIC one. Owner-only fields — their own profile
    // and the labels they gave their wallets — are grafted on here, for the
    // owner alone, so a cache hit can never serve them to somebody else.
    return {
      ...view.dto,
      isOwner,
      owner: isOwner ? view.owner : null,
      wallets: isOwner
        ? view.dto.wallets.map((w) => ({ ...w, label: view!.labels[w.id] ?? null }))
        : view.dto.wallets,
    };
  }

  private async buildView(slug: string): Promise<CachedView> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: {
        owner: { include: { user: true } },
        wallets: { include: { positions: true } },
      },
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

    const user = portfolio.owner?.user ?? null;
    const dto: PortfolioDto = {
      slug: portfolio.slug,
      name: portfolio.name,
      // Never in the cached (public) view — filled in for the owner in getBySlug
      owner: null,
      visibility: !portfolio.owner ? 'anonymous' : portfolio.owner.isPublic ? 'public' : 'private',
      totalUsd: round2(wallets.reduce((sum, w) => sum + (w.totalUsd ?? 0), 0)),
      // Labels are stripped here and handed back to the owner separately
      wallets: wallets.map((w) => ({ ...w, label: null })),
      isOwner: false,
      updatedAt,
      createdAt: portfolio.createdAt.toISOString(),
    };
    return {
      ownerUserId: portfolio.owner?.userId ?? null,
      owner: user
        ? {
            name:
              [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Anonymous',
            username: user.username,
            photoUrl: user.photoUrl,
          }
        : null,
      labels: Object.fromEntries(wallets.map((w) => [w.id, w.label])),
      dto,
    };
  }

  /** Publish or unpublish an owned portfolio. Owner-only, by definition. */
  async setVisibility(
    slug: string,
    userId: string,
    isPublic: boolean,
  ): Promise<{ visibility: PortfolioVisibility }> {
    const portfolio = await this.requireOwned(slug, userId);
    await this.prisma.portfolioOwner.update({
      where: { portfolioId: portfolio.id },
      data: { isPublic },
    });
    await this.cache.del(cacheKey(slug));
    return { visibility: isPublic ? 'public' : 'private' };
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
    if (!chain) throw unsupportedNetwork();

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
    this.requestScan(wallet.id);
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
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { owner: true },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    // An anonymous portfolio has no owner, so nobody can claim it either
    if (portfolio.owner?.userId !== userId) throw new ForbiddenException("This isn't your portfolio");
    return portfolio;
  }

  /**
   * The scan is async: the endpoint responds immediately (status=pending) and
   * the frontend polls. An EVM scan takes 20–40 seconds — we can't hold an HTTP
   * request open that long.
   */
  private requestScan(walletId: string): void {
    void fetch(`${config.walletServiceUrl}/internal/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
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
        note: p.note,
        amount: p.amount,
        priceUsd: p.priceUsd,
        valueUsd: round2(p.valueUsd),
        platform: p.platform,
        category: p.category as PositionCategory,
        apy: p.apy,
        healthRate: p.healthRate,
        range: (p.range as PositionRange | null) ?? null,
        // Written by the wallet service as PositionTokenDto[]; Prisma types it as
        // opaque JSON, so this is the one place the shape is asserted
        tokens: (p.tokens as PositionTokenDto[] | null) ?? null,
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
