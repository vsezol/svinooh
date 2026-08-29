import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Wallet } from '@prisma/client';
import type { Chain, TronResources } from '@svinooh/shared';
import { config } from '../config';
import { ScanHold, setting } from '@svinooh/common';
import { MetricsService, RabbitService, WALLET_STATE_QUEUE, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { alertableStates } from './wallet-state';
import { scanAddress } from '../scanners';
import type { ScanPosition, ScanResult } from '@svinooh/shared';

/**
 * What the wallet could collect right now, and what it owes.
 *
 * Both are read off the legs of each position rather than off the position's
 * own total: a lending position's value is already net of its debt, so the debt
 * is only visible one level down. Borrow legs arrive negative and are counted
 * as what they are — an amount owed, which is a positive number.
 *
 * The same two sums are derived in the browser for the cards on the portfolio
 * page (`web/src/lib/blocks.ts`). They are computed here as well because a
 * chart needs them at the moment of the reading, and there is no reading to go
 * back to afterwards.
 */
function accrued(positions: ScanPosition[]): { claimableUsd: number; debtUsd: number } {
  let claimableUsd = 0;
  let debtUsd = 0;
  for (const position of positions) {
    for (const token of position.tokens ?? []) {
      if (token.role === 'reward') claimableUsd += token.valueUsd;
      else if (token.role === 'borrow') debtUsd += Math.abs(token.valueUsd);
    }
  }
  return { claimableUsd, debtUsd };
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly rabbit: RabbitService,
  ) {}


  /**
   * The addresses that are DUE for a rescan, most urgent first.
   *
   * Each address has a due time, and one that isn't due is simply not enqueued.
   * That is what paces us against the upstream sources — before it existed the
   * producer refilled the queue the moment it drained and rescanned everything
   * every ~1.8 minutes, which is roughly 4,800 DeBank page loads a day from one
   * datacenter IP and is what got us throttled.
   *
   * Two tiers:
   *   fast (SYNC_INTERVAL_MIN) — somebody opened a portfolio holding it recently
   *   slow (SYNC_IDLE_INTERVAL_MIN) — nobody has looked in a while
   *
   * An address in several portfolios takes the fastest tier any of them asks
   * for. `lastViewedAt` belongs to the api, which owns those rows — we only
   * read it.
   */
  async listGroups(): Promise<ScanJob[]> {
    const now = Date.now();
    const activeSince = new Date(now - setting('sync.activeWindowMin') * 60_000);
    const claimedSince = new Date(now - setting('scan.claimTtlMin') * 60_000);

    const wallets = await this.prisma.wallet.findMany({
      where: {
        // Already on its way. A claim older than the TTL is not believed: a
        // scanner can die, and a held scan never publishes a result to clear it.
        OR: [{ scanQueuedAt: null }, { scanQueuedAt: { lt: claimedSince } }],
      },
      select: {
        chain: true,
        address: true,
        lastSyncedAt: true,
        lastTotalUsd: true,
        tronResourcesAt: true,
        memberships: {
          select: { portfolio: { select: { lastViewedAt: true } } },
        },
      },
    });

    const due = wallets
      .map((w) => {
        const fast = w.memberships.some(
          (m) => (m.portfolio.lastViewedAt?.getTime() ?? 0) >= activeSince.getTime(),
        );
        const intervalMs =
          (fast ? setting('sync.intervalMin') : setting('sync.idleIntervalMin')) * 60_000;
        const lastSyncedAt = w.lastSyncedAt?.getTime() ?? null;
        return {
          ...w,
          fast,
          overdueBy: lastSyncedAt === null ? Infinity : now - lastSyncedAt - intervalMs,
        };
      })
      .filter((w) => w.overdueBy >= 0)
      // Actively-viewed addresses go first; within a tier, whatever has been
      // waiting longest
      .sort((a, b) => Number(b.fast) - Number(a.fast) || b.overdueBy - a.overdueBy);

    // previousTotal travels with the job so the scanner can re-read a
    // suspicious drop while it still has the page open
    return due.map((w) => ({
      chain: w.chain as Chain,
      address: w.address,
      previousTotal: w.lastTotalUsd,
      tronResourcesAt: w.tronResourcesAt?.toISOString() ?? null,
    }));
  }

  async applyResult(wallet: Wallet, result: ScanResult): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.position.deleteMany({ where: { walletId: wallet.id } }),
      this.prisma.position.createMany({
        data: result.positions.map((p) => ({
          walletId: wallet.id,
          symbol: p.symbol.slice(0, 120),
          name: p.name?.slice(0, 200) ?? null,
          note: p.note?.slice(0, 300) ?? null,
          amount: p.amount ?? null,
          priceUsd: p.priceUsd ?? null,
          valueUsd: p.valueUsd,
          platform: p.platform ?? null,
          category: p.category,
          apy: p.apy ?? null,
          healthRate: p.healthRate ?? null,
          borrowApy: p.borrowApy ?? null,
          range: p.range ?? null,
          // Prisma types JSON columns structurally; our leg array has to be
          // handed over as an opaque JSON value
          tokens: p.tokens?.length ? (p.tokens as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        })),
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: 'ok',
          lastTotalUsd: result.totalUsd,
          lastSyncedAt: now,
          lastError: null,
          breakdown: result.breakdown ?? {},
          unpriced: result.unpriced ?? [],
          // Only when this scan actually read them. A scan that skipped the
          // read (not due) or whose read failed leaves the stored snapshot
          // alone — replacing it with a gap would blank the page and, worse,
          // re-baseline the reclaim/delegate flags into silence.
          ...(result.tron
            ? {
                tronResources: result.tron as unknown as Prisma.InputJsonValue,
                tronResourcesAt: now,
              }
            : {}),
        },
      }),
      this.prisma.addressSnapshot.create({
        data: {
          chain: wallet.chain,
          address: wallet.address,
          totalUsd: result.totalUsd,
          ...accrued(result.positions),
          breakdown: result.breakdown ?? undefined,
        },
      }),
    ]);
    await this.announce(wallet, result);
  }

  /**
   * Says what the address looks like now, for whoever decides who should hear
   * about it.
   *
   * Published after the positions are written, not before: a reader that came
   * to look would otherwise find the previous scan's rows and answer about the
   * wrong state. It carries no owner and no settings — who watches this address
   * and what they asked for is the reader's business, and a scan should not
   * have to know. One message per address, however many portfolios hold it; the
   * collector is what fans it out to their separate thresholds.
   *
   * A failure to publish is logged and swallowed. The scan succeeded and its
   * result is stored; losing the announcement costs one cycle of alerts, and
   * failing the scan over it would cost the balance too.
   */
  private async announce(wallet: Wallet, result: ScanResult): Promise<void> {
    const positions = alertableStates(result.positions);
    // Resources this scan read, or the ones already stored — the collector is
    // judging the wallet as it stands, and a scan that did not re-read them has
    // not made them untrue. Whichever we have; null if there has never been one.
    const tron = result.tron ?? ((wallet.tronResources as TronResources | null) || null);
    // An address with neither a watchable position nor resources has nothing
    // anybody could have asked to hear about
    if (!positions.length && !tron) return;
    try {
      await this.rabbit.publish(WALLET_STATE_QUEUE, {
        walletId: wallet.id,
        address: wallet.address,
        chain: wallet.chain as Chain,
        positions,
        tron,
        // The scanners drop what they could not reach before this point, so
        // nothing here can name it yet. Carrying it is what will let a reader
        // hold a position's previous state instead of calling it gone.
        unreachable: [],
        at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`could not announce ${wallet.address}: ${(error as Error).message}`);
    }
  }

  /**
   * Take this address, or report that a scan is already on its way for it.
   *
   * One UPDATE, because two statements (look, then mark) is the race it exists
   * to close: the producer's tick and a wallet somebody has just added arrive at
   * the same moment by design, and the api's forced scan is at its most likely
   * to collide precisely when the address is new. Postgres locks the rows for
   * the duration, so a second caller re-reads the row it waited for, no longer
   * matches the WHERE, and updates nothing — and `count` is how many rows were
   * actually claimed, so zero means somebody else holds it.
   *
   * It claims every Wallet row for the address at once, because one scan serves
   * all of them.
   */
  async claimForScan(chain: string, address: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - setting('scan.claimTtlMin') * 60_000);
    const { count } = await this.prisma.wallet.updateMany({
      where: {
        chain,
        address,
        OR: [{ scanQueuedAt: null }, { scanQueuedAt: { lt: staleBefore } }],
      },
      data: { scanQueuedAt: new Date() },
    });
    return count > 0;
  }

  /**
   * A result came back — or never will, because the job was never sent.
   *
   * Called on every path out of applying a result, including the ones that write
   * nothing: the claim says "a result is still on its way", and once one has
   * arrived that is no longer true whatever it said. Not called when a scan is
   * HELD (DeBank throttling), since nothing is published to trigger it — the
   * claim simply ages out, and until it does that address is not rescanned,
   * which is what a backoff should do anyway.
   */
  async releaseScan(chain: string, address: string): Promise<void> {
    await this.prisma.wallet.updateMany({
      where: { chain, address },
      data: { scanQueuedAt: null },
    });
  }

  /**
   * Wallets still waiting for a first scan that nothing is going to deliver.
   *
   * `pending` means "on its way". It stops being true when a scan ends without
   * a result — a held one publishes nothing, a dying scanner publishes nothing —
   * and nothing then corrects the wallet, because the writer only ever hears
   * about scans that came back. The page reads that as a spinner and polls it
   * every three seconds, so the claim has to expire.
   *
   * Only wallets with no live claim: one that is still on its way is not stuck,
   * it is waiting its turn. The row stays due (lastSyncedAt is untouched), so
   * the next top-up picks it up again — this gives up on the claim, not on the
   * wallet.
   */
  async failStuckPending(): Promise<number> {
    const now = Date.now();
    const claimedSince = new Date(now - setting('scan.claimTtlMin') * 60_000);
    const waitingSince = new Date(now - setting('scan.stuckPendingMin') * 60_000);
    const { count } = await this.prisma.wallet.updateMany({
      where: {
        status: 'pending',
        lastSyncedAt: null,
        createdAt: { lt: waitingSince },
        OR: [{ scanQueuedAt: null }, { scanQueuedAt: { lt: claimedSince } }],
      },
      data: { status: 'failed', lastError: 'No scan came back for this address — retrying' },
    });
    return count;
  }

  /** We deliberately leave the last successful cached value untouched — it's served with a stale flag */
  async markFailed(wallet: Wallet, message: string): Promise<void> {
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { status: 'failed', lastError: message.slice(0, 500) },
    });
  }

  /** Which portfolios hold this address, so their totals can be re-recorded */
  async portfoliosHolding(walletId: string): Promise<string[]> {
    const rows = await this.prisma.portfolioWallet.findMany({
      where: { walletId },
      select: { portfolioId: true },
    });
    return [...new Set(rows.map((r) => r.portfolioId))];
  }

  async snapshotPortfolio(portfolioId: string): Promise<void> {
    const held = await this.prisma.portfolioWallet.findMany({
      where: { portfolioId },
      select: { wallet: { select: { lastTotalUsd: true } } },
    });
    if (!held.length) {
      // the last wallet was removed — record a zero so the chart reflects it
      await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd: 0 } });
      return;
    }
    const known = held.filter((h) => h.wallet.lastTotalUsd !== null);
    if (!known.length) return; // nothing has been scanned yet
    const totalUsd = known.reduce((sum, h) => sum + (h.wallet.lastTotalUsd ?? 0), 0);
    await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd } });
  }
}
