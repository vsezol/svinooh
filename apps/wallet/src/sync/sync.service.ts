import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Wallet } from '@prisma/client';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { ScanHold } from '@svinooh/common';
import { MetricsService, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
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
  ) {}


  /**
   * The addresses that are DUE for a rescan, most urgent first.
   *
   * Previously this returned everything and the producer refilled the queue the
   * moment it drained, so wallets were rescanned every ~1.8 minutes regardless
   * of SYNC_INTERVAL_MIN — roughly 4,800 DeBank page loads a day from one
   * datacenter IP, which is what got us throttled. Now each address has a due
   * time, and one that isn't due is simply not enqueued.
   *
   * Two tiers:
   *   fast (SYNC_INTERVAL_MIN) — the address is in somebody's own portfolio, or
   *                              in one that was opened recently
   *   slow (SYNC_IDLE_INTERVAL_MIN) — it only exists in anonymous portfolios
   *                                   nobody has looked at lately
   *
   * An address in several portfolios takes the fastest tier any of them asks
   * for. Ownership and lastViewedAt belong to the api, which owns those rows —
   * we only read them.
   */
  async listGroups(): Promise<ScanJob[]> {
    const wallets = await this.prisma.wallet.findMany({
      select: {
        chain: true,
        address: true,
        lastSyncedAt: true,
        lastTotalUsd: true,
        portfolio: {
          select: { lastViewedAt: true, owner: { select: { portfolioId: true } } },
        },
      },
    });

    const now = Date.now();
    const activeSince = now - config.syncActiveWindowMin * 60_000;
    const groups = new Map<
      string,
      {
        chain: string;
        address: string;
        owned: boolean;
        active: boolean;
        lastSyncedAt: number | null;
        previousTotal: number | null;
      }
    >();

    for (const w of wallets) {
      const key = `${w.chain}:${w.address}`;
      const owned = w.portfolio.owner !== null;
      const active = (w.portfolio.lastViewedAt?.getTime() ?? 0) >= activeSince;
      const syncedAt = w.lastSyncedAt?.getTime() ?? null;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          chain: w.chain,
          address: w.address,
          owned,
          active,
          lastSyncedAt: syncedAt,
          previousTotal: w.lastTotalUsd,
        });
        continue;
      }
      existing.owned ||= owned;
      existing.active ||= active;
      existing.previousTotal ??= w.lastTotalUsd;
      // The group is scanned as one, so the freshest sync among its wallets is
      // the group's — scanning again earlier would buy nothing
      if (syncedAt !== null && (existing.lastSyncedAt === null || syncedAt > existing.lastSyncedAt)) {
        existing.lastSyncedAt = syncedAt;
      }
    }

    const due = [...groups.values()]
      .map((g) => {
        const fast = g.owned || g.active;
        const intervalMs =
          (fast ? config.syncIntervalMin : config.syncIdleIntervalMin) * 60_000;
        return { ...g, fast, overdueBy: g.lastSyncedAt === null ? Infinity : now - g.lastSyncedAt - intervalMs };
      })
      .filter((g) => g.overdueBy >= 0)
      // Owned and actively-viewed wallets go first; within a tier, whatever has
      // been waiting longest
      .sort((a, b) => Number(b.fast) - Number(a.fast) || b.overdueBy - a.overdueBy);

    // previousTotal travels with the job so the scanner can re-read a
    // suspicious drop while it still has the page open
    return due.map((g) => ({
      chain: g.chain as Chain,
      address: g.address,
      previousTotal: g.previousTotal,
    }));
  }

  async applyResult(group: Wallet[], result: ScanResult): Promise<void> {
    const now = new Date();
    for (const wallet of group) {
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
          },
        }),
        this.prisma.walletSnapshot.create({
          data: {
            walletId: wallet.id,
            totalUsd: result.totalUsd,
            ...accrued(result.positions),
            breakdown: result.breakdown,
          },
        }),
      ]);
    }
  }

  /** We deliberately leave the last successful cached value untouched — it's served with a stale flag */
  async markFailed(group: Wallet[], message: string): Promise<void> {
    await this.prisma.wallet.updateMany({
      where: { id: { in: group.map((w) => w.id) } },
      data: { status: 'failed', lastError: message.slice(0, 500) },
    });
  }

  async snapshotPortfolio(portfolioId: string): Promise<void> {
    const wallets = await this.prisma.wallet.findMany({ where: { portfolioId } });
    if (!wallets.length) {
      // the last wallet was removed — record a zero so the chart reflects it
      await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd: 0 } });
      return;
    }
    const known = wallets.filter((w) => w.lastTotalUsd !== null);
    if (!known.length) return; // nothing has been scanned yet
    const totalUsd = known.reduce((sum, w) => sum + (w.lastTotalUsd ?? 0), 0);
    await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd } });
  }
}
