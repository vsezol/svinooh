import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Portfolio, PortfolioOwner, Position, Wallet } from '@prisma/client';
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
import { randomSlug, round2 } from '../common/util';
import { config } from '../config';
import { PrismaService } from '@svinooh/db';
import { detectChain } from '../scanners/detect';
import { CacheService } from '../cache/cache.service';

type WalletWithPositions = Wallet & { positions: Position[] };
type PortfolioWithOwner = Portfolio & { owner: PortfolioOwner | null };

/**
 * How many wallets a portfolio nobody owns may hold. Anyone can add to one, and
 * everything in it is rescanned for as long as it exists — so it is capped, and
 * the message points at the way to go bigger.
 */
const ANONYMOUS_WALLET_LIMIT = 10;

/**
 * How far back to look for what a wallet was worth going into a window.
 *
 * Measured, not guessed: on a live portfolio the scanner's bad patches run 7 to
 * 11 snapshots long — a scan fails for half an hour, not for one minute. Twelve
 * samples was therefore a window a glitch could be the majority of, which is
 * exactly how it kept surviving. Forty is a couple of hours at the current
 * cadence, and no observed run comes close to owning that.
 */
const LEVEL_SAMPLES = 40;

/**
 * How many windows of history a range reaches back for. A period is the width
 * of the chart's window, so the readings on either side of it have to exist for
 * there to be anything to scroll to — and this is where that stops, before the
 * query turns into a year of five-minute readings.
 */
const SCREENS = 6;

/** Readings drawn across one window. What is fetched is this times SCREENS. */
const POINTS_PER_WINDOW = 200;

/**
 * Each period is a window width and a resolution to draw it at. `all` has no
 * width: it is the whole history at a glance, and there is nothing either side
 * of it to scroll to.
 */
const RANGES: Record<HistoryRange, { windowMs: number | null; bucket: string | null }> = {
  '1h': { windowMs: 3600e3, bucket: null }, // fetched raw; gridded to GRID_STEP_MS below
  '24h': { windowMs: 24 * 3600e3, bucket: null },
  '7d': { windowMs: 7 * 86400e3, bucket: '30 minutes' },
  '30d': { windowMs: 30 * 86400e3, bucket: '2 hours' },
  all: { windowMs: null, bucket: '6 hours' },
};

/**
 * The width of one slot on the chart's time grid — see toTimeGrid. The chart
 * (lightweight-charts) spaces points by index, not by time, so a run of scans a
 * minute apart and a pair three minutes apart draw at the same width unless the
 * series is first laid onto a fixed grid. This is what one index step is worth.
 * For the bucketed ranges it MUST match RANGES.bucket, so the SQL buckets and
 * the grid that fills the gaps between them line up.
 */
const GRID_STEP_MS: Record<HistoryRange, number> = {
  '1h': 60_000, // 1 min
  '24h': 5 * 60_000, // 5 min
  '7d': 30 * 60_000, // 30 min — matches bucket '30 minutes'
  '30d': 2 * 3_600_000, // 2 h — matches bucket '2 hours'
  all: 6 * 3_600_000, // 6 h — matches bucket '6 hours'
};

/** Where a range's query starts: SCREENS windows back, or the beginning for `all` */
function windowStart(range: HistoryRange): Date | null {
  const { windowMs } = RANGES[range];
  return windowMs === null ? null : new Date(Date.now() - windowMs * SCREENS);
}

export function normalizeRange(raw: string | undefined): HistoryRange {
  return raw === '1h' || raw === '7d' || raw === '30d' || raw === 'all' ? raw : '24h';
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
  /**
   * The level this wallet arrives at — see levelsBefore. Without it the first
   * sample is unjudgeable, since it *is* `lastGood`, so a scan that glitched
   * low right on the window edge became the level the whole chart was measured
   * from: a 24h chart opening at $18.9k on a $84.5k portfolio, reporting +342%
   * on a day it had barely moved, while the 7d chart of the same portfolio was
   * correct because its window starts earlier and leaves the same glitch
   * mid-series where the recovery test can see it.
   */
  seed?: number,
): Array<{ t: number; v: number }> {
  // We tell a glitch from real movement not by depth but by recovery: the price
  // dips and returns almost exactly to its previous value (the wallet data
  // recovered, nothing actually changed). Real movement doesn't bounce back
  // that precisely.
  const DROP = 0.9; // a drawdown deeper than 10% is an outlier candidate
  const RECOVER = 0.98; // if it returned to 98%+ of the previous value, it was an outlier
  const WINDOW = 90; // how far ahead we look for recovery (~1.5h at a 1-min sync)
  const out = series.map((s) => ({ t: s.t, v: s.v }));
  let lastGood = seed ?? series[0].v;
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
function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

interface Sample {
  t: number;
  usd: number;
}

/**
 * Lays an unevenly-timed series onto a uniform time grid, so the chart — which
 * spaces points by index, not by time — ends up spacing them by time. Every
 * slot is `stepMs` wide, and each holds the last reading at or before it:
 * carry-forward, not interpolation, because the value between two scans is the
 * last one we actually saw, not a straight line drawn through the gap. A stretch
 * with no scans then reads as a flat run as wide as the stretch, instead of
 * collapsing to a single step the way raw snapshots do.
 *
 * The first and last real timestamps are preserved exactly, so the window math
 * on the client (which pins to the newest reading) still lands where it should.
 */
function toTimeGrid(points: Sample[], stepMs: number): Sample[] {
  if (points.length < 2 || stepMs <= 0) return points;
  const end = points[points.length - 1].t;
  const out: Sample[] = [];
  let i = 0;
  for (let t = points[0].t; t < end; t += stepMs) {
    while (i + 1 < points.length && points[i + 1].t <= t) i++;
    out.push({ t, usd: points[i].usd });
  }
  out.push(points[points.length - 1]); // the latest reading, exact and on the edge
  return out;
}

const toPoints = (samples: Sample[]): HistoryPointDto[] =>
  samples.map((s) => ({ t: new Date(s.t).toISOString(), usd: s.usd }));

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
          (p.name ?? '').toLowerCase().includes(q) ||
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
        // No name: a portfolio is identified by its slug. Naming it after the
        // wallet it currently holds would be wrong the moment a second wallet
        // joins — the whole point of a portfolio is that it aggregates.
        slug: randomSlug(),
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
      // Record the visit so the wallet service knows this portfolio is being
      // looked at and keeps it fresh. Only on a cache MISS, which the 60s TTL
      // already throttles to at most one write a minute per portfolio — and
      // never in the way of the response.
      this.touchViewed(slug);
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

  /**
   * Someone opened this portfolio. Best-effort: a failure here must never turn
   * a page view into an error, and the value is only ever used to pick a rescan
   * cadence.
   */
  private touchViewed(slug: string): void {
    void this.prisma.portfolio
      .update({ where: { slug }, data: { lastViewedAt: new Date() } })
      .catch(() => {});
  }

  /**
   * Take ownership of a portfolio nobody owns.
   *
   * This is what closes the loop on building one without an account: assemble
   * it anonymously, sign in, and it becomes yours — rather than signing in and
   * being handed a different, empty portfolio while the wallets you gathered
   * stay ownerless.
   *
   * It becomes PRIVATE in the process. It was listed publicly while it belonged
   * to nobody, but a portfolio that belongs to someone is private until they say
   * otherwise — that rule doesn't bend just because of how this one started.
   */
  async claim(slug: string, userId: string): Promise<{ slug: string }> {
    const portfolio = await this.load(slug);
    if (portfolio.owner) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ALREADY_OWNED',
        message: 'This portfolio already belongs to someone',
      });
    }

    await this.prisma.portfolioOwner.create({
      data: { portfolioId: portfolio.id, userId, isPublic: false },
    });

    // Signing in hands every new account an empty portfolio. If that is all it
    // has, the one just claimed is plainly the one they meant — leaving the
    // empty shell behind would give them two and a UI that only shows one.
    const others = await this.prisma.portfolioOwner.findMany({
      where: { userId, portfolioId: { not: portfolio.id } },
      include: { portfolio: { include: { wallets: { select: { id: true } } } } },
    });
    const emptyIds = others.filter((o) => o.portfolio.wallets.length === 0).map((o) => o.portfolioId);
    if (emptyIds.length) await this.prisma.portfolio.deleteMany({ where: { id: { in: emptyIds } } });

    await this.cache.del(cacheKey(slug));
    return { slug: portfolio.slug };
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

  /** Set or clear the portfolio's name. Empty clears it — back to just the slug. */
  async rename(slug: string, userId: string, nameRaw: string): Promise<{ name: string | null }> {
    const portfolio = await this.requireOwned(slug, userId);
    const name = String(nameRaw || '').trim().slice(0, 64) || null;
    await this.prisma.portfolio.update({ where: { id: portfolio.id }, data: { name } });
    await this.cache.del(cacheKey(slug));
    return { name };
  }

  /**
   * Add a wallet. Owners can always do this; an ANONYMOUS portfolio accepts it
   * from anyone, signed in or not — that is the point of it, you can assemble
   * one and share the link before deciding whether you want an account.
   * Renaming and removing stay owner-only: building something up is safe to
   * leave open, taking it apart is not.
   */
  async addWallet(slug: string, userId: string | null, addressRaw: string): Promise<WalletDto> {
    const portfolio = await this.requireWritable(slug, userId);
    const address = String(addressRaw || '').trim();
    if (!address) throw new BadRequestException('Empty address');

    const chain = detectChain(address);
    if (!chain) throw unsupportedNetwork();

    // A portfolio nobody owns is also a portfolio nobody is responsible for, so
    // it doesn't get to grow without limit — every wallet is rescanned forever.
    if (!portfolio.owner) {
      const count = await this.prisma.wallet.count({ where: { portfolioId: portfolio.id } });
      if (count >= ANONYMOUS_WALLET_LIMIT) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'ANONYMOUS_LIMIT',
          message: `A shared portfolio holds up to ${ANONYMOUS_WALLET_LIMIT} wallets. Sign in to build a bigger one.`,
        });
      }
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
    const since = windowStart(range);
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

    // What each wallet was worth just before the window opened. Two jobs: it
    // tells the smoothing what level the series arrives at, and it stands in
    // for wallets that have no snapshot in the range at all (never synced
    // during the whole period), so the total covers every wallet and the line
    // isn't understated.
    const prior = since ? await this.levelsBefore(walletIds, since) : new Map<string, number>();

    // each wallet's starting point (carry-back) — the first smoothed value in the range
    const baseline = new Map<string, number>();
    const events: Array<{ t: number; id: string; v: number }> = [];
    for (const [id, series] of byWallet) {
      const smooth = smoothSeries(series, prior.get(id));
      baseline.set(id, smooth[0].v);
      for (const p of smooth) events.push({ t: p.t, id, v: p.v });
    }
    for (const [id, v] of prior) if (!baseline.has(id)) baseline.set(id, v);

    // walk the events in time order, sum = Σ of the last known values
    // (initially = the starting ones, so a "new" wallet is present from t0)
    events.sort((a, b) => a.t - b.t);
    const current = new Map<string, number>(baseline);
    const raw: Sample[] = [];
    for (const e of events) {
      current.set(e.id, e.v);
      let sum = 0;
      for (const v of current.values()) sum += v;
      raw.push({ t: e.t, usd: round2(sum) });
    }
    // Onto a uniform time grid first, so the chart spaces these by time and not
    // by index — otherwise scans a minute apart and scans five minutes apart sit
    // the same distance apart. Then thin to a drawable count: enough for every
    // window in the reach to be drawn at the density one window deserves —
    // capping the whole series at a screenful would hand back a day in twenty
    // points.
    const grid = toTimeGrid(raw, GRID_STEP_MS[range]);
    const cap = RANGES[range].windowMs === null ? 220 : POINTS_PER_WINDOW * SCREENS;
    return toPoints(downsample(grid, cap));
  }

  /**
   * What each wallet was worth going into `before` — the high-water mark of its
   * recent snapshots, not its last one and not their middle.
   *
   * A bad scan reads a wallet as poorer than it is; nothing makes it read as
   * richer. So the largest recent value is the one reading that cannot be a
   * glitch, and taking it survives a bad patch of any length — which matters,
   * because the bad patches here are long enough to outvote a median.
   *
   * Reaching high cannot invent value. Nothing is ever rewritten to this level:
   * it only decides whether the first sample in the window looks like a drop,
   * and smoothSeries holds a drop only when the series climbs back to it. A
   * wallet that genuinely fell never does, so a real fall stays a real fall.
   */
  private async levelsBefore(walletIds: string[], before: Date): Promise<Map<string, number>> {
    if (!walletIds.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ walletId: string; totalUsd: number }>>(
      Prisma.sql`
        SELECT "walletId", "totalUsd" FROM (
          SELECT "walletId", "totalUsd",
                 row_number() OVER (PARTITION BY "walletId" ORDER BY "createdAt" DESC) AS rn
          FROM "WalletSnapshot"
          WHERE "walletId" IN (${Prisma.join(walletIds)}) AND "createdAt" < ${before}
        ) recent WHERE rn <= ${LEVEL_SAMPLES}
      `,
    );
    const levels = new Map<string, number>();
    for (const r of rows) levels.set(r.walletId, Math.max(levels.get(r.walletId) ?? 0, r.totalUsd));
    return levels;
  }

  async walletHistory(slug: string, walletId: string, range: HistoryRange): Promise<HistoryDto> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolio: { slug } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const points = await this.series('WalletSnapshot', 'walletId', wallet.id, range);
    return { range, points };
  }

  /** Owner-only: renaming, removing, publishing */
  private async requireOwned(slug: string, userId: string): Promise<PortfolioWithOwner> {
    const portfolio = await this.load(slug);
    // An anonymous portfolio has no owner, so nobody can claim these rights over it
    if (portfolio.owner?.userId !== userId) throw new ForbiddenException("This isn't your portfolio");
    return portfolio;
  }

  /** Owner, or anybody at all when the portfolio belongs to nobody */
  private async requireWritable(slug: string, userId: string | null): Promise<PortfolioWithOwner> {
    const portfolio = await this.load(slug);
    if (!portfolio.owner) return portfolio;
    if (portfolio.owner.userId !== userId) throw new ForbiddenException("This isn't your portfolio");
    return portfolio;
  }

  private async load(slug: string): Promise<PortfolioWithOwner> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { owner: true },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
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
   * Series for the charts. The short windows use raw points (step = sync
   * interval); the longer ones are aggregated into date_bin buckets on the
   * Postgres side, at the resolution their window is drawn at.
   */
  private async series(
    table: 'PortfolioSnapshot' | 'WalletSnapshot',
    fkColumn: 'portfolioId' | 'walletId',
    id: string,
    range: HistoryRange,
  ): Promise<HistoryPointDto[]> {
    const { bucket } = RANGES[range];
    const since = windowStart(range);

    let raw: Sample[];
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
      raw = rows.map((row) => ({ t: row.createdAt.getTime(), usd: round2(row.totalUsd) }));
    } else {
      const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; usd: number }>>(Prisma.sql`
        SELECT date_bin(${bucket}::interval, "createdAt", TIMESTAMP '2020-01-01') AS bucket,
               AVG("totalUsd")::float8 AS usd
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE ${Prisma.raw(`"${fkColumn}"`)} = ${id}
          ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}
        GROUP BY bucket
        ORDER BY bucket ASC
      `);
      raw = rows.map((row) => ({ t: row.bucket.getTime(), usd: round2(Number(row.usd)) }));
    }

    // Same uniform-grid treatment as the portfolio series: spaced by time, gaps
    // carried forward, then thinned to a drawable count. The SQL buckets are
    // already on a grid but skip the empty ones; this fills them back in so the
    // spacing reads true.
    const grid = toTimeGrid(raw, GRID_STEP_MS[range]);
    const cap = RANGES[range].windowMs === null ? 220 : POINTS_PER_WINDOW * SCREENS;
    return toPoints(downsample(grid, cap));
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
        borrowApy: p.borrowApy,
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
