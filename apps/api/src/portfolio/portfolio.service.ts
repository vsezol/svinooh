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
  AddressLookupDto,
  AlertSettingsDto,
  Chain,
  HistoryDto,
  HistoryPointDto,
  HistoryRange,
  PortfolioDto,
  PortfolioOwnerDto,
  PortfolioVisibility,
  PositionBand,
  PositionCategory,
  PositionHistoryDto,
  PositionRange,
  PositionTokenDto,
  PublicPortfolioDto,
  TransfersDto,
  TronResources,
  TronResourcesDto,
  UpdateWalletAlertsDto,
  WalletAlertsDto,
  WalletDto,
  WalletSyncStatus,
} from '@svinooh/shared';
import { round2 } from '../common/util';
import { config } from '../config';
import { PrismaService } from '@svinooh/db';
import { detectChain, normalizeAddress, RESERVED_SLUGS, setting, slugifyName, wordSlug } from '@svinooh/common';
import { PremiumService } from '../billing/premium.service';
import { ScanRequests } from '../wallet/scan-requests.service';
import { positionKey } from '../wallet/sync/wallet-state';
import { positionSeries } from './position-history';
import { portfolioTransfers } from './transfers';

/**
 * A wallet as a portfolio holds it: the address and its readings, plus the
 * label that belongs to this portfolio's copy of it and nobody else's.
 */
type HeldWallet = { id: string; label: string | null; wallet: Wallet & { positions: Position[] } };
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

/** The later of a range's own start and the viewer's floor; null — no bound */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
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

/** Rounds a reading that may not have been taken at all */
function nullableRound(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : round2(Number(value));
}

/**
 * Adds up what every wallet last reported, or says it does not know. A single
 * wallet with nothing recorded — every wallet, before the release that started
 * recording it — makes the sum unknown rather than smaller.
 */
function totalOf(byWallet: Map<string, number | null>): number | null {
  let sum = 0;
  for (const v of byWallet.values()) {
    if (v === null) return null;
    sum += v;
  }
  return round2(sum);
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
  /** What could be collected and what was owed — null until either was recorded */
  claimable: number | null;
  debt: number | null;
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
function toTimeGrid<T extends { t: number }>(points: T[], stepMs: number): T[] {
  if (points.length < 2 || stepMs <= 0) return points;
  const end = points[points.length - 1].t;
  const out: T[] = [];
  let i = 0;
  for (let t = points[0].t; t < end; t += stepMs) {
    while (i + 1 < points.length && points[i + 1].t <= t) i++;
    // All three readings come off the same scan, so a slot carries the whole of
    // what was last seen rather than a fresh total against a stale debt
    out.push({ ...points[i], t });
  }
  out.push(points[points.length - 1]); // the latest reading, exact and on the edge
  return out;
}

const toPoints = (samples: Sample[]): HistoryPointDto[] =>
  samples.map((s) => ({
    t: new Date(s.t).toISOString(),
    usd: s.usd,
    claimableUsd: s.claimable,
    debtUsd: s.debt,
  }));

/**
 * What a wallet is watched for until its owner says otherwise. The client shows
 * these before the first answer arrives, so the two lists have to agree — see
 * web/src/lib/alerts.ts.
 */
const ALERT_DEFAULTS = {
  rangeAlerts: true,
  healthFactorBelow: 1.1,
  borrowApyAbove: 12,
  // On by default like range alerts, and for the same reason: somebody who adds
  // a Tron wallet wants to hear that a delegation came free. Both are one-way —
  // they say something became possible, never that it stopped being.
  tronReclaimAlerts: true,
  tronDelegateAlerts: true,
} as const;

/** A wallet with no row of its own is a wallet on the defaults */
function toAlertsDto(
  walletId: string,
  row: {
    rangeAlerts: boolean;
    healthFactorBelow: number | null;
    borrowApyAbove: number | null;
    tronReclaimAlerts: boolean;
    tronDelegateAlerts: boolean;
  } | null,
): WalletAlertsDto {
  return {
    walletId,
    ...(row
      ? {
          rangeAlerts: row.rangeAlerts,
          healthFactorBelow: row.healthFactorBelow,
          borrowApyAbove: row.borrowApyAbove,
          tronReclaimAlerts: row.tronReclaimAlerts,
          tronDelegateAlerts: row.tronDelegateAlerts,
        }
      : ALERT_DEFAULTS),
  };
}

/** A threshold nobody is watching, or a number that can actually be crossed */
function threshold(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * How often one portfolio's visit is worth writing down: a minute.
 *
 * A view is one indexed UPDATE plus a reprioritising `updateMany`, and the page
 * asks for the portfolio every 3 seconds while a wallet is still pending. What
 * the write is FOR is the scan cadence — somebody is looking, so keep this
 * wallet fresh — and that question is not answered any better by asking it
 * twenty times a minute.
 *
 * Per process, which is the whole mechanism: with several replicas this is at
 * most one write per replica per minute, and the value being written is the
 * same `now` either way.
 */
const VISIT_WINDOW_MS = 60_000;
const visited = new Map<string, number>();

/** Has this portfolio's visit already been recorded this minute? */
function visitIsFresh(slug: string, now: number): boolean {
  const last = visited.get(slug);
  if (last !== undefined && now - last < VISIT_WINDOW_MS) return true;
  // Bounded by what it is worth remembering: entries past the window say
  // nothing, and a process that has served a lot of portfolios must not carry
  // a key for each of them forever
  if (visited.size > 10_000) {
    for (const [key, at] of visited) if (now - at >= VISIT_WINDOW_MS) visited.delete(key);
  }
  visited.set(slug, now);
  return false;
}

/** A write the unique index refused: another request's row got there first */
const uniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

function unsupportedNetwork(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'UNSUPPORTED_NETWORK',
    message: 'Could not detect the address network. Supported: BTC, EVM (0x…), SOL and TRON.',
  });
}

/**
 * The assembled portfolio. `dto` is the PUBLIC view and nothing else — the
 * owner's profile and their wallet labels sit beside it and are only ever merged
 * in for a request authenticated as the owner. Keeping them apart rather than
 * stripping them afterwards means the public payload is public by construction,
 * not by remembering to delete a field.
 */
interface PortfolioView {
  ownerUserId: string | null;
  owner: PortfolioOwnerDto | null;
  labels: Record<string, string | null>;
  /** The owner's saved view preference, merged in for the owner alone */
  hideSmallBalances: boolean;
  dto: PortfolioDto;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly premium: PremiumService,
    private readonly scans: ScanRequests,
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
      include: { owner: { select: { portfolioId: true } }, wallets: { include: { wallet: true } } },
    });

    const q = query.trim().toLowerCase().replace(/^@/, '');
    return portfolios
      .map((portfolio) => {
        const held = portfolio.wallets.map((m) => m.wallet);
        const known = held.filter((w) => w.lastTotalUsd !== null);
        return {
          slug: portfolio.slug,
          name: portfolio.name,
          totalUsd: round2(known.reduce((sum, w) => sum + (w.lastTotalUsd ?? 0), 0)),
          walletCount: held.length,
          chains: [...new Set(held.map((w) => w.chain as Chain))],
          anonymous: portfolio.owner === null,
          addresses: held.map((w) => w.address.toLowerCase()),
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
   * What the search dropdown shows for a pasted address, without creating
   * anything: the network it belongs to, what the address was last worth, and
   * the anonymous portfolio that already opens it (if one exists). Read-only
   * twin of findOrCreateAnonymous — same detection, same normalization, same
   * "exactly this one wallet" query — so what the row promises is what a click
   * then gets.
   *
   * Everything returned is public by construction: the chain and the value are
   * readable off the chain itself by anyone with the address, and slug/name can
   * only come from an ownerless portfolio, which carries no user data at all.
   */
  async lookupAddress(addressRaw: string): Promise<AddressLookupDto> {
    const raw = String(addressRaw || '').trim();
    const chain = detectChain(raw);
    if (!chain) return { chain: null, address: raw, totalUsd: null, slug: null, name: null };
    const address = normalizeAddress(chain, raw);

    const [wallet, existing] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { chain_address: { chain, address } } }),
      this.prisma.portfolio.findFirst({
        where: {
          owner: null,
          wallets: { some: { wallet: { address } }, every: { wallet: { address } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { slug: true, name: true },
      }),
    ]);

    return {
      chain,
      address,
      totalUsd: wallet?.lastTotalUsd ?? null,
      slug: existing?.slug ?? null,
      name: existing?.name ?? null,
    };
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
    const address = normalizeAddress(chain, raw);

    // An existing anonymous portfolio for exactly this one wallet, nothing else
    const existing = await this.prisma.portfolio.findFirst({
      where: {
        owner: null,
        wallets: { some: { wallet: { address } }, every: { wallet: { address } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return { slug: existing.slug };

    const wallet = await this.upsertAddress(chain, address);
    // No name: a portfolio is identified by its slug. Naming it after the
    // wallet it currently holds would be wrong the moment a second wallet
    // joins — the whole point of a portfolio is that it aggregates.
    const portfolio = await this.createWithSlug({
      wallets: { create: { walletId: wallet.id } },
    });
    // Only if nobody has scanned this address before — an address already known
    // to another portfolio arrives with its value and needs no queue jump
    if (wallet.lastSyncedAt === null) this.scans.now(wallet.id);
    return { slug: portfolio.slug };
  }

  /**
   * Public view: a portfolio is visible via its link without signing in.
   *
   * Read straight from Postgres, one query per request. It used to be served
   * from a Redis entry with a TTL, and nothing invalidated that entry when a
   * scan landed — the pipeline writes to Postgres and had never heard of
   * Redis — so the TTL was simply a delay on every number on the page, longest
   * exactly where it was felt most: a wallet waiting for its first scan, polled
   * every 3 seconds for a result the cache already had and would not hand over.
   *
   * `viewing` is the caller saying a person has this open. Only the portfolio
   * page says it — see the controller for what reading it as a visit cost.
   */
  async getBySlug(slug: string, userId: string | null, viewing = false): Promise<PortfolioDto> {
    const view = await this.buildView(slug);
    // Somebody is looking at this portfolio, so the pipeline keeps it
    // fresh. Never in the way of the response, and at most once a minute — see
    // VISIT_WINDOW_MS for why that is enough.
    if (viewing && !visitIsFresh(slug, Date.now())) this.touchViewed(slug);
    const isOwner = userId !== null && view.ownerUserId === userId;
    // `view.dto` is the PUBLIC view. Owner-only fields — their own profile and
    // the labels they gave their wallets — are grafted on here, for the owner
    // alone, so nobody else is ever served somebody's identity.
    return {
      ...view.dto,
      isOwner,
      owner: isOwner ? view.owner : null,
      hideSmallBalances: isOwner && view.hideSmallBalances,
      wallets: isOwner
        ? view.dto.wallets.map((w) => ({ ...w, label: view.labels[w.id] ?? null }))
        : view.dto.wallets,
    };
  }

  private async buildView(slug: string): Promise<PortfolioView> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: {
        owner: { include: { user: true } },
        wallets: { include: { wallet: { include: { positions: true } } } },
      },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    // Overdue against the wallet's OWN schedule, which is the only fair way to
    // ask since the tiers diverged. This used to be a flat three times the
    // ACTIVE interval — fifteen minutes — from when every owned wallet was on
    // that interval. A wallet nobody has opened is now read every thirty
    // minutes on purpose, so its normal age is anywhere from zero to thirty:
    // measured against fifteen it was badged stale for half of every cycle,
    // forever, for keeping exactly the schedule it was given.
    //
    // The grace is one lease, because being briefly past due is the normal
    // state of a working queue — it means dispatched and waiting, not behind.
    const overdueBefore = Date.now() - setting('scan.leaseMin') * 60_000;
    const wallets = portfolio.wallets
      .map((held) => this.toWalletDto(held, overdueBefore))
      .sort(walletOrder);

    const updatedAt = wallets.reduce<string | null>(
      (latest, w) => (w.lastSyncedAt && (!latest || w.lastSyncedAt > latest) ? w.lastSyncedAt : latest),
      null,
    );

    const user = portfolio.owner?.user ?? null;
    const dto: PortfolioDto = {
      slug: portfolio.slug,
      name: portfolio.name,
      // Never in the public view — filled in for the owner in getBySlug
      owner: null,
      hideSmallBalances: false,
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
      hideSmallBalances: portfolio.owner?.hideSmallBalances ?? false,
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
    void this.prisma
      .$transaction(async (tx) => {
        const portfolio = await tx.portfolio.update({
          where: { slug },
          data: { lastViewedAt: new Date() },
          select: { id: true },
        });
        // Somebody is back, so their wallets go back on the fast interval NOW
        // rather than after one more slow cycle. Without this, returning to a
        // portfolio left alone for a day means watching a stale number for up
        // to half an hour while the schedule catches up — and the whole point
        // of pacing by visits is that a visit is what speeds it up.
        //
        // Only ever EARLIER: GREATEST/LEAST would be the SQL, and this is the
        // Prisma spelling of it — an address already due sooner is left alone,
        // and one in flight keeps its lease because that is later than now but
        // the filter below only touches rows due further out than the fast
        // interval.
        const soon = new Date(Date.now() + setting('sync.activeIntervalMin') * 60_000);
        await tx.wallet.updateMany({
          where: {
            memberships: { some: { portfolioId: portfolio.id } },
            nextScanAt: { gt: soon },
          },
          data: { nextScanAt: soon },
        });
      })
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
  /**
   * One more portfolio for an account that already has some. The same shape
   * first sign-in creates: private, unnamed, identified by its slug — a name
   * would be shown to strangers the moment it goes public, so it stays the
   * owner's to write.
   */
  async createOwned(userId: string): Promise<{ slug: string }> {
    await this.premium.assertAnotherPortfolio(userId);
    const portfolio = await this.createWithSlug({ owner: { create: { userId } } });
    return { slug: portfolio.slug };
  }

  /**
   * Create a portfolio under a fresh word slug. The words give ~260k
   * combinations, which is readable but not collision-proof — so the unique
   * constraint is the arbiter and a hit just deals a new hand (with digits
   * joining after a couple of misses; see wordSlug).
   */
  private async createWithSlug(data: Omit<Prisma.PortfolioCreateInput, 'slug'>): Promise<Portfolio> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.portfolio.create({ data: { ...data, slug: wordSlug(attempt) } });
      } catch (err) {
        if (!uniqueViolation(err) || attempt >= 5) throw err;
      }
    }
  }

  async claim(slug: string, userId: string): Promise<{ slug: string }> {
    const portfolio = await this.load(slug);
    if (portfolio.owner) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ALREADY_OWNED',
        message: 'This portfolio already belongs to someone',
      });
    }
    // Claiming makes one more OWNED portfolio, so it walks the same gate as
    // creating one — otherwise "assemble anonymously, then claim" would be the
    // standing way around the limit. Empty portfolios are ignored because the
    // lines below delete them: the shell sign-in handed out must not block
    // somebody's first real portfolio.
    await this.premium.assertAnotherPortfolio(userId, { ignoreEmpty: true });

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

    return { slug: portfolio.slug };
  }

  /**
   * Delete an owned portfolio: its memberships, labels, alerts and ownership
   * go with it (all cascades). The addresses themselves stay —
   * another portfolio may be tracking them, and if none is they simply stop
   * being due for a scan.
   *
   * The account's LAST portfolio is not deletable. Signing in guarantees every
   * account a portfolio, and the UI leans on that — me.portfolioSlug is where
   * "your portfolio" buttons point. Making another first is one press away.
   */
  async remove(slug: string, userId: string): Promise<{ ok: true }> {
    const portfolio = await this.requireOwned(slug, userId);
    const owned = await this.prisma.portfolioOwner.count({ where: { userId } });
    if (owned <= 1) {
      throw new ConflictException('This is your only portfolio — create another before deleting it');
    }
    await this.prisma.portfolio.delete({ where: { id: portfolio.id } });
    return { ok: true };
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
    return { visibility: isPublic ? 'public' : 'private' };
  }

  /** Remember the owner's "hide small balances" switch. Owner-only. */
  async setHideSmallBalances(
    slug: string,
    userId: string,
    hideSmallBalances: boolean,
  ): Promise<{ hideSmallBalances: boolean }> {
    const portfolio = await this.requireOwned(slug, userId);
    await this.prisma.portfolioOwner.update({
      where: { portfolioId: portfolio.id },
      data: { hideSmallBalances },
    });
    return { hideSmallBalances };
  }

  /**
   * What every wallet in the portfolio is watched for.
   *
   * Answers for a wallet nobody has configured too, with the defaults. A client
   * that had to fill in the gaps itself would be showing a threshold as if the
   * server had agreed to it, and the two would drift the first time a default
   * changed on one side.
   *
   * Owner-only. A wallet still on its first sync is left out: what it holds
   * decides which of these settings can ever fire, and it has not said yet.
   */
  async alerts(slug: string, userId: string): Promise<AlertSettingsDto> {
    const portfolio = await this.requireOwned(slug, userId);
    const held = await this.prisma.portfolioWallet.findMany({
      where: { portfolioId: portfolio.id, wallet: { status: { not: 'pending' } } },
      select: { id: true, alerts: true },
      orderBy: { createdAt: 'asc' },
    });
    return { wallets: held.map((h) => toAlertsDto(h.id, h.alerts)) };
  }

  /**
   * Change one wallet's settings. A patch: a field left out is left alone, and
   * a threshold set to null is nobody watching it — which is why an absent key
   * and an explicit null have to stay distinguishable all the way down.
   */
  async setWalletAlerts(
    slug: string,
    walletId: string,
    userId: string,
    patch: UpdateWalletAlertsDto,
  ): Promise<WalletAlertsDto> {
    const portfolio = await this.requireOwned(slug, userId);
    const held = await this.prisma.portfolioWallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
      select: { id: true },
    });
    if (!held) throw new NotFoundException('Wallet not found');

    const data = {
      ...('rangeAlerts' in patch ? { rangeAlerts: patch.rangeAlerts === true } : {}),
      ...('healthFactorBelow' in patch
        ? { healthFactorBelow: threshold(patch.healthFactorBelow) }
        : {}),
      ...('borrowApyAbove' in patch ? { borrowApyAbove: threshold(patch.borrowApyAbove) } : {}),
      ...('tronReclaimAlerts' in patch
        ? { tronReclaimAlerts: patch.tronReclaimAlerts === true }
        : {}),
      ...('tronDelegateAlerts' in patch
        ? { tronDelegateAlerts: patch.tronDelegateAlerts === true }
        : {}),
    };
    const saved = await this.prisma.walletAlerts.upsert({
      where: { portfolioWalletId: walletId },
      // The row is this holder's settings, so creating one has to start from the
      // same defaults the client was shown, not from whatever the patch happened
      // to mention
      create: { portfolioWalletId: walletId, ...ALERT_DEFAULTS, ...data },
      update: data,
    });
    return toAlertsDto(walletId, saved);
  }

  /**
   * Set or clear the portfolio's name. Empty clears it — back to just the slug.
   *
   * The slug follows the name: calling it "DeFi Long Game" moves the portfolio
   * to /p/defi-long-game, because a link that says what it points at is the
   * point of naming it. The cost is honest and accepted: the old link stops
   * working the moment the owner renames — their own shared links included.
   * Clearing the name keeps the current slug; a working link beats a fresh
   * coat of random words.
   */
  async rename(
    slug: string,
    userId: string,
    nameRaw: string,
  ): Promise<{ name: string | null; slug: string }> {
    const portfolio = await this.requireOwned(slug, userId);
    const name = String(nameRaw || '').trim().slice(0, 64) || null;

    let nextSlug = portfolio.slug;
    if (name) {
      const base = slugifyName(name);
      if (!base) {
        throw new BadRequestException('The name needs some English letters or digits — they become the link');
      }
      if (base !== portfolio.slug) nextSlug = await this.vacantSlug(base, portfolio.id);
    }

    try {
      await this.prisma.portfolio.update({
        where: { id: portfolio.id },
        data: { name, slug: nextSlug },
      });
    } catch (err) {
      // Somebody grabbed the slug between the check and the write
      if (uniqueViolation(err)) {
        throw new ConflictException('That name is taken — try another');
      }
      throw err;
    }
    return { name, slug: nextSlug };
  }

  /**
   * The name's slug, or the nearest free variant of it: base, base-2, base-3…
   * Route literals count as taken — a portfolio at /p/public would shadow the
   * public listing (see the controller's route-order note).
   */
  private async vacantSlug(base: string, selfId: string): Promise<string> {
    for (let n = 1; n <= 50; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (RESERVED_SLUGS.has(candidate)) continue;
      const holder = await this.prisma.portfolio.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!holder || holder.id === selfId) return candidate;
    }
    throw new ConflictException('That name is taken — try another');
  }

  /**
   * Add a wallet. Owners can always do this; an ANONYMOUS portfolio accepts it
   * from anyone, signed in or not — that is the point of it, you can assemble
   * one and share the link before deciding whether you want an account.
   * Renaming and removing stay owner-only: building something up is safe to
   * leave open, taking it apart is not.
   *
   * Asking twice is asking once. The address is this operation's natural key —
   * a portfolio holds an address at most once, and the unique index on
   * (portfolioId, walletId) is what says so — so a repeat answers with the
   * wallet already there rather than an error: a retry after a lost response,
   * a double click, two tabs at once. `created` tells the first answer from
   * the repeats, and the controller turns it into 201 or 200.
   */
  async addWallet(
    slug: string,
    userId: string | null,
    addressRaw: string,
  ): Promise<{ wallet: WalletDto; created: boolean }> {
    const portfolio = await this.requireWritable(slug, userId);
    const raw = String(addressRaw || '').trim();
    if (!raw) throw new BadRequestException('Empty address');

    const chain = detectChain(raw);
    if (!chain) throw unsupportedNetwork();
    // Same spelling as the landing stores, or the same wallet enters this
    // portfolio twice and is counted twice in its total — see normalizeAddress
    const address = normalizeAddress(chain, raw);

    // Before the cap: a wallet that is already in is not one more, so a repeat
    // at the limit gets its wallet back and not the paywall
    const already = await this.heldIn(portfolio.id, chain, address);
    if (already) return { wallet: this.toWalletDto(already, 0), created: false };

    // Every wallet is rescanned for as long as it exists, so growth is capped:
    // the free plan's cap on portfolios its members add to, and a hard ceiling
    // on ownerless ones either way — a portfolio nobody owns is a portfolio
    // nobody is responsible for, and Pro does not change who answers for it.
    const cap = await this.premium.walletCap(userId);
    const count = await this.prisma.portfolioWallet.count({ where: { portfolioId: portfolio.id } });
    if (!portfolio.owner) {
      const limit = Math.min(cap ?? ANONYMOUS_WALLET_LIMIT, ANONYMOUS_WALLET_LIMIT);
      if (count >= limit) {
        // A signed-in member has a paywall to be shown; a stranger is asked to
        // sign in first — the dialog they can act on
        if (userId !== null && cap !== null && count >= cap) throw this.premium.paywall('wallets');
        throw new BadRequestException({
          statusCode: 400,
          code: 'ANONYMOUS_LIMIT',
          message: `A shared portfolio holds up to ${limit} wallets. Sign in and go Pro to build a bigger one.`,
        });
      }
    } else if (cap !== null && count >= cap) {
      throw this.premium.paywall('wallets');
    }

    const wallet = await this.upsertAddress(chain, address);
    let held: HeldWallet;
    try {
      held = await this.prisma.portfolioWallet.create({
        data: { portfolioId: portfolio.id, walletId: wallet.id },
        include: { wallet: { include: { positions: true } } },
      });
    } catch (err) {
      // Another request added it between the look above and this write. The
      // unique index refused the second row, and the first one is the answer.
      const raced = uniqueViolation(err) ? await this.heldIn(portfolio.id, chain, address) : null;
      if (!raced) throw err;
      return { wallet: this.toWalletDto(raced, 0), created: false };
    }
    // An address somebody else already tracks arrives with its readings and its
    // positions; only one nobody has scanned yet needs to jump the queue
    if (wallet.lastSyncedAt === null) this.scans.now(wallet.id);
    return { wallet: this.toWalletDto(held, 0), created: true };
  }

  /** This portfolio's hold on an address, with what the address holds */
  private heldIn(portfolioId: string, chain: Chain, address: string): Promise<HeldWallet | null> {
    return this.prisma.portfolioWallet.findFirst({
      where: { portfolioId, wallet: { chain, address } },
      include: { wallet: { include: { positions: true } } },
    });
  }

  async renameWallet(
    slug: string,
    userId: string,
    walletId: string,
    labelRaw: string,
  ): Promise<{ label: string | null }> {
    const portfolio = await this.requireOwned(slug, userId);
    const held = await this.prisma.portfolioWallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
    });
    if (!held) throw new NotFoundException('Wallet not found');
    // An empty name resets to the default (null)
    const label = String(labelRaw || '').trim().slice(0, 40) || null;
    await this.prisma.portfolioWallet.update({ where: { id: held.id }, data: { label } });
    return { label };
  }

  async removeWallet(slug: string, userId: string, walletId: string): Promise<{ ok: true }> {
    const portfolio = await this.requireOwned(slug, userId);
    const held = await this.prisma.portfolioWallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
    });
    if (!held) throw new NotFoundException('Wallet not found');
    // Only this portfolio's hold on the address. The address itself, and its
    // history, stay — somebody else may be tracking it, and if nobody is it
    // simply stops being due for a scan.
    await this.prisma.portfolioWallet.delete({ where: { id: held.id } });
    return { ok: true };
  }

  async history(slug: string, range: HistoryRange, userId: string | null): Promise<HistoryDto> {
    const notBefore = await this.historyFloor(range, userId);
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { wallets: { select: { wallet: { select: { chain: true, address: true } } } } },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    const points = await this.reconstructPortfolioSeries(
      portfolio.wallets.map((m) => m.wallet),
      range,
      notBefore,
    );
    return { range, points };
  }

  async transfers(slug: string): Promise<TransfersDto> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      select: { wallets: { select: { id: true, wallet: { select: { chain: true, address: true } } } } },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    return portfolioTransfers(
      portfolio.wallets.map((m) => ({ id: m.id, chain: m.wallet.chain as Chain, address: m.wallet.address })),
    );
  }

  /**
   * Where the free plan's reach ends for this viewer, or null for the whole
   * history. A range whose own window is wider than the reach has nothing
   * honest to draw — that is the paywall, not a clamp; the narrower ranges
   * still answer and simply stop scrolling past the floor.
   *
   * Judged per VIEWER, not per portfolio: what exists on the chart is a fact
   * about public addresses, and how much of it one person may leaf through is
   * a fact about their plan.
   */
  private async historyFloor(range: HistoryRange, userId: string | null): Promise<Date | null> {
    const days = await this.premium.historyDays(userId);
    if (days === null) return null;
    const reachMs = days * 86400e3;
    const { windowMs } = RANGES[range];
    if (windowMs === null || windowMs > reachMs) throw this.premium.paywall('history');
    return new Date(Date.now() - reachMs);
  }

  /**
   * Portfolio value series without the "jumps" caused by adding wallets: we
   * assemble it from per-address snapshots, where each address's value is carried
   * back across the whole range by its earliest known value. This way adding a
   * wallet doesn't look like a profit: change = Σ(current) − Σ(starting) = the
   * sum of real per-wallet profit, and change% = Σprofit / Σstarting.
   *
   * Keyed by (chain, address), not by Wallet row: a wallet reused in a new
   * portfolio brings the address's whole history with it, so the line reaches
   * back to before the portfolio existed rather than starting flat at t0.
   */
  private async reconstructPortfolioSeries(
    pairs: Array<{ chain: string; address: string }>,
    range: HistoryRange,
    notBefore: Date | null,
  ): Promise<HistoryPointDto[]> {
    if (!pairs.length) return [];
    const since = laterOf(windowStart(range), notBefore);
    const snaps = await this.prisma.addressSnapshot.findMany({
      where: {
        OR: pairs.map((p) => ({ chain: p.chain, address: p.address })),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        chain: true,
        address: true,
        createdAt: true,
        totalUsd: true,
        claimableUsd: true,
        debtUsd: true,
      },
    });
    if (!snaps.length) return [];

    // group snapshots by address (already sorted by time) and smooth each one —
    // removing short-lived glitch dips that recover on their own
    const byAddress = new Map<
      string,
      Array<{ t: number; v: number; claimable: number | null; debt: number | null }>
    >();
    for (const s of snaps) {
      const key = `${s.chain}:${s.address}`;
      const arr = byAddress.get(key) ?? [];
      arr.push({
        t: s.createdAt.getTime(),
        v: s.totalUsd,
        claimable: s.claimableUsd,
        debt: s.debtUsd,
      });
      byAddress.set(key, arr);
    }

    // What each wallet was worth just before the window opened. Two jobs: it
    // tells the smoothing what level the series arrives at, and it stands in
    // for wallets that have no snapshot in the range at all (never synced
    // during the whole period), so the total covers every wallet and the line
    // isn't understated.
    const prior = since ? await this.levelsBefore(pairs, since) : new Map<string, number>();

    // each wallet's starting point (carry-back) — the first smoothed value in the range
    const baseline = new Map<string, number>();
    // Same idea for the other two, so a wallet added mid-window does not look
    // like a debt appearing out of nowhere. They are seeded from the wallet's
    // own first reading rather than from a level query: what came before the
    // window is only recorded for the total.
    const baseClaimable = new Map<string, number | null>();
    const baseDebt = new Map<string, number | null>();
    const events: Array<{
      t: number;
      id: string;
      v: number;
      claimable: number | null;
      debt: number | null;
    }> = [];
    for (const [id, series] of byAddress) {
      const smooth = smoothSeries(series, prior.get(id));
      baseline.set(id, smooth[0].v);
      baseClaimable.set(id, series[0].claimable);
      baseDebt.set(id, series[0].debt);
      // Only the total is smoothed. The glitch test holds a drop that recovers
      // to where it was, which is exactly what these two do not do: claiming
      // takes the claimable to zero and it stays there, and repaying does the
      // same to a debt. Running the total's test over them would hold a real
      // claim as if it had never happened.
      for (let i = 0; i < smooth.length; i++) {
        events.push({
          t: smooth[i].t,
          id,
          v: smooth[i].v,
          claimable: series[i].claimable,
          debt: series[i].debt,
        });
      }
    }
    for (const [id, v] of prior) if (!baseline.has(id)) baseline.set(id, v);

    // walk the events in time order, sum = Σ of the last known values
    // (initially = the starting ones, so a "new" wallet is present from t0)
    events.sort((a, b) => a.t - b.t);
    const current = new Map<string, number>(baseline);
    const claimable = new Map<string, number | null>(baseClaimable);
    const debt = new Map<string, number | null>(baseDebt);
    const raw: Sample[] = [];
    for (const e of events) {
      current.set(e.id, e.v);
      claimable.set(e.id, e.claimable);
      debt.set(e.id, e.debt);
      let sum = 0;
      for (const v of current.values()) sum += v;
      raw.push({
        t: e.t,
        usd: round2(sum),
        // One wallet that has not reported these yet makes the whole sum
        // unknown. Treating its silence as a zero would draw a portfolio as
        // owing less than it does, which is the one direction that must not
        // happen by accident.
        claimable: totalOf(claimable),
        debt: totalOf(debt),
      });
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
  private async levelsBefore(
    pairs: Array<{ chain: string; address: string }>,
    before: Date,
  ): Promise<Map<string, number>> {
    if (!pairs.length) return new Map();
    const wanted = Prisma.join(pairs.map((p) => Prisma.sql`(${p.chain}, ${p.address})`));
    const rows = await this.prisma.$queryRaw<Array<{ chain: string; address: string; totalUsd: number }>>(
      Prisma.sql`
        SELECT "chain", "address", "totalUsd" FROM (
          SELECT "chain", "address", "totalUsd",
                 row_number() OVER (PARTITION BY "chain", "address" ORDER BY "createdAt" DESC) AS rn
          FROM "AddressSnapshot"
          WHERE ("chain", "address") IN (${wanted}) AND "createdAt" < ${before}
        ) recent WHERE rn <= ${LEVEL_SAMPLES}
      `,
    );
    const levels = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.chain}:${r.address}`;
      levels.set(key, Math.max(levels.get(key) ?? 0, r.totalUsd));
    }
    return levels;
  }

  async walletHistory(
    slug: string,
    walletId: string,
    range: HistoryRange,
    userId: string | null,
  ): Promise<HistoryDto> {
    const notBefore = await this.historyFloor(range, userId);
    const held = await this.prisma.portfolioWallet.findFirst({
      where: { id: walletId, portfolio: { slug } },
      select: { wallet: { select: { chain: true, address: true } } },
    });
    if (!held) throw new NotFoundException('Wallet not found');
    // By (chain, address): a wallet's own history shows the address's full past,
    // including the stretch recorded while it lived in another portfolio.
    const points = await this.addressSeries(held.wallet.chain, held.wallet.address, range, notBefore);
    return { range, points };
  }

  async positionHistory(
    slug: string,
    walletId: string,
    key: string,
    range: HistoryRange,
    userId: string | null,
  ): Promise<PositionHistoryDto> {
    const notBefore = await this.historyFloor(range, userId);
    const held = await this.prisma.portfolioWallet.findFirst({
      where: { id: walletId, portfolio: { slug } },
      select: { wallet: { select: { chain: true, address: true } } },
    });
    if (!held) throw new NotFoundException('Wallet not found');

    const { windowMs } = RANGES[range];
    const since = laterOf(windowMs === null ? null : new Date(Date.now() - windowMs), notBefore);
    const stepMs = GRID_STEP_MS[range];
    const rows = await this.prisma.$queryRaw<
      Array<{
        createdAt: Date;
        valueUsd: number;
        amount: number | null;
        tokens: PositionTokenDto[] | null;
      }>
    >(Prisma.sql`
      SELECT "createdAt", "valueUsd", "amount", "tokens"
      FROM "PositionSnapshot"
      WHERE "id" IN (
        SELECT DISTINCT ON (slot) "id"
        FROM (
          SELECT "id", "createdAt",
                 date_bin(${`${stepMs / 1000} seconds`}::interval, "createdAt", TIMESTAMP '2020-01-01') AS slot
          FROM "PositionSnapshot"
          WHERE "chain" = ${held.wallet.chain} AND "address" = ${held.wallet.address} AND "key" = ${key}
            ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}
        ) slots
        ORDER BY slot, "createdAt" DESC
      )
      ORDER BY "createdAt" ASC
    `);

    const readings = rows.map((row) => ({
      t: row.createdAt.getTime(),
      usd: row.valueUsd,
      amount: row.amount,
      tokens: row.tokens,
    }));
    const cap = windowMs === null ? 220 : POINTS_PER_WINDOW;
    return { range, ...positionSeries(downsample(toTimeGrid(readings, stepMs), cap)) };
  }

  /**
   * The row for this address, created if this is the first portfolio to ask for
   * it.
   *
   * An address is scanned once for everybody, so adding one somebody else
   * already tracks costs nothing and arrives with its readings already in
   * place. `upsert` rather than find-then-create because two people can add the
   * same address in the same instant, and the unique index is the arbiter.
   */
  private async upsertAddress(chain: Chain, address: string): Promise<Wallet> {
    return this.prisma.wallet.upsert({
      where: { chain_address: { chain, address } },
      create: { chain, address },
      update: {},
    });
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
   * One address's series for the charts. The short windows use raw points
   * (step = sync interval); the longer ones are aggregated into date_bin buckets
   * on the Postgres side, at the resolution their window is drawn at.
   *
   * Reads AddressSnapshot by (chain, address), so this is the same history the
   * address contributes to every portfolio that holds it — a wallet's own chart
   * and the portfolio total are two views of the same underlying readings.
   */
  private async addressSeries(
    chain: string,
    address: string,
    range: HistoryRange,
    notBefore: Date | null,
  ): Promise<HistoryPointDto[]> {
    const { bucket } = RANGES[range];
    const since = laterOf(windowStart(range), notBefore);

    let raw: Sample[];
    if (!bucket) {
      const rows = await this.prisma.addressSnapshot.findMany({
        where: { chain, address, ...(since ? { createdAt: { gte: since } } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, totalUsd: true, claimableUsd: true, debtUsd: true },
      });
      raw = rows.map((row) => ({
        t: row.createdAt.getTime(),
        usd: round2(row.totalUsd),
        claimable: nullableRound(row.claimableUsd),
        debt: nullableRound(row.debtUsd),
      }));
    } else {
      // AVG skips nulls, so a bucket straddling the release that started
      // recording these averages what was recorded and answers null only where
      // nothing was
      const rows = await this.prisma.$queryRaw<
        Array<{ bucket: Date; usd: number; claimable: number | null; debt: number | null }>
      >(Prisma.sql`
        SELECT date_bin(${bucket}::interval, "createdAt", TIMESTAMP '2020-01-01') AS bucket,
               AVG("totalUsd")::float8 AS usd,
               AVG("claimableUsd")::float8 AS claimable,
               AVG("debtUsd")::float8 AS debt
        FROM "AddressSnapshot"
        WHERE "chain" = ${chain} AND "address" = ${address}
          ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}
        GROUP BY bucket
        ORDER BY bucket ASC
      `);
      raw = rows.map((row) => ({
        t: row.bucket.getTime(),
        usd: round2(Number(row.usd)),
        claimable: nullableRound(row.claimable),
        debt: nullableRound(row.debt),
      }));
    }

    // Same uniform-grid treatment as the portfolio series: spaced by time, gaps
    // carried forward, then thinned to a drawable count. The SQL buckets are
    // already on a grid but skip the empty ones; this fills them back in so the
    // spacing reads true.
    const grid = toTimeGrid(raw, GRID_STEP_MS[range]);
    const cap = RANGES[range].windowMs === null ? 220 : POINTS_PER_WINDOW * SCREENS;
    return toPoints(downsample(grid, cap));
  }

  /**
   * `id` is the MEMBERSHIP's id, not the address's. Everything the browser does
   * with it — rename, remove, set alerts — is about this portfolio's hold on
   * the address rather than about the address, and the one thing that is not
   * (its history) is resolved through the membership on the way.
   */
  private toWalletDto(held: HeldWallet, overdueBefore: number): WalletDto {
    const wallet = held.wallet;
    const positions = [...wallet.positions]
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .map((p) => ({
        id: p.id,
        key: positionKey({ ...p, band: p.band as PositionBand | null }),
        symbol: p.symbol,
        name: p.name,
        note: p.note,
        network: p.network,
        amount: p.amount,
        priceUsd: p.priceUsd,
        valueUsd: round2(p.valueUsd),
        platform: p.platform,
        category: p.category as PositionCategory,
        apy: p.apy,
        healthRate: p.healthRate,
        borrowApy: p.borrowApy,
        range: (p.range as PositionRange | null) ?? null,
        band: (p.band as PositionBand | null) ?? null,
        // Written by the scan pipeline as PositionTokenDto[]; Prisma types it as
        // opaque JSON, so this is the one place the shape is asserted
        tokens: (p.tokens as PositionTokenDto[] | null) ?? null,
        feesEarnedUsd: p.feesEarnedUsd,
      }));

    return {
      id: held.id,
      address: wallet.address,
      chain: wallet.chain as Chain,
      label: held.label,
      totalUsd: wallet.lastTotalUsd === null ? null : round2(wallet.lastTotalUsd),
      status: wallet.status as WalletSyncStatus,
      stale:
        wallet.status !== 'pending' &&
        (wallet.lastSyncedAt === null || wallet.nextScanAt.getTime() < overdueBefore),
      lastSyncedAt: wallet.lastSyncedAt?.toISOString() ?? null,
      lastError: wallet.lastError,
      breakdown: (wallet.breakdown as Record<string, number> | null) ?? null,
      positions,
      unpriced: (wallet.unpriced as string[] | null) ?? undefined,
      tron: toTronDto(wallet.tronResources, wallet.tronResourcesAt),
      createdAt: wallet.createdAt.toISOString(),
    };
  }
}

/**
 * A Tron wallet's resources, with the two things the page would otherwise have
 * to work out for itself.
 *
 * `reclaimableNow` and `nextReclaimAt` are derived here rather than in the
 * browser so that the page, the Telegram message and the alert all answer the
 * same question the same way — the rule that `expireAt` of 0 means "no lock at
 * all", not "expired in 1970", is exactly the kind of thing that drifts when it
 * is written down twice.
 *
 * Public, like every other number on a portfolio: what an address holds and
 * what it has delegated is on the chain for anyone to read, and says nothing
 * about who owns it.
 */
function toTronDto(stored: unknown, readAt: Date | null): TronResourcesDto | null {
  if (!stored || !readAt) return null;
  const resources = stored as TronResources;
  const now = Date.now();
  let reclaimableNow = false;
  let nextReclaimAt: number | null = null;
  for (const delegation of resources.delegations ?? []) {
    if (!delegation.expireAt || delegation.expireAt <= now) reclaimableNow = true;
    else if (nextReclaimAt === null || delegation.expireAt < nextReclaimAt) {
      nextReclaimAt = delegation.expireAt;
    }
  }
  return {
    ...resources,
    readAt: readAt.toISOString(),
    reclaimableNow,
    nextReclaimAt: nextReclaimAt === null ? null : new Date(nextReclaimAt).toISOString(),
  };
}

/** Wallets ordered by descending value; not-yet-scanned ones go to the end */
function walletOrder(a: WalletDto, b: WalletDto): number {
  if (a.totalUsd === null && b.totalUsd === null) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.totalUsd === null) return 1;
  if (b.totalUsd === null) return -1;
  return b.totalUsd - a.totalUsd;
}
