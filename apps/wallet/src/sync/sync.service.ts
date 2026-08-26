import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Wallet } from '@prisma/client';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { ScanHold } from '../common/scan-hold';
import { MetricsService } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { ScanJob } from '../queue/rabbit.service';
import { scanAddress } from '../scanners';
import { closeBrowser } from '../scanners/browser';
import type { ScanResult } from '../scanners/types';
import { scanQueue } from './scan-queue';

@Injectable()
export class SyncService implements OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  /** In-flight scans keyed by `${chain}:${address}` — keeps the loop and the "scan on add" from running the same address twice */
  private readonly inFlight = new Set<string>();
  /** Counter of consecutive suspicious drops per address */
  private readonly dropStreak = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleDestroy() {
    await closeBrowser();
  }

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
        portfolio: {
          select: { lastViewedAt: true, owner: { select: { portfolioId: true } } },
        },
      },
    });

    const now = Date.now();
    const activeSince = now - config.syncActiveWindowMin * 60_000;
    const groups = new Map<
      string,
      { chain: string; address: string; owned: boolean; active: boolean; lastSyncedAt: number | null }
    >();

    for (const w of wallets) {
      const key = `${w.chain}:${w.address}`;
      const owned = w.portfolio.owner !== null;
      const active = (w.portfolio.lastViewedAt?.getTime() ?? 0) >= activeSince;
      const syncedAt = w.lastSyncedAt?.getTime() ?? null;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { chain: w.chain, address: w.address, owned, active, lastSyncedAt: syncedAt });
        continue;
      }
      existing.owned ||= owned;
      existing.active ||= active;
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

    return due.map((g) => ({ chain: g.chain, address: g.address }));
  }

  /** Scan a single address from the queue: the scan itself plus a snapshot of affected portfolios */
  async scanOne(job: ScanJob): Promise<void> {
    const wallets = await this.prisma.wallet.findMany({
      where: { chain: job.chain, address: job.address },
    });
    if (!wallets.length) return;
    await this.scanGroup(job.chain as Chain, job.address, wallets);
    const portfolioIds = [...new Set(wallets.map((w) => w.portfolioId))];
    for (const portfolioId of portfolioIds) await this.snapshotPortfolio(portfolioId);
  }

  /** Immediate scan of a just-added wallet */
  async scanWalletNow(walletId: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;
    await this.scanGroup(wallet.chain as Chain, wallet.address, [wallet]);
    await this.snapshotPortfolio(wallet.portfolioId);
  }

  private async scanGroup(chain: Chain, address: string, group: Wallet[]): Promise<void> {
    const key = `${chain}:${address}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    try {
      const previousTotal = group.map((w) => w.lastTotalUsd).find((v) => v !== null) ?? null;
      const result = await this.scanWithSanityCheck(key, chain, address, previousTotal);
      await this.applyResult(group, result);
      this.metrics.scans.inc({ chain, result: 'ok' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A hold is our own decision, not a broken source: keep the wallet exactly
      // as it was — status, value and all — so the page keeps showing the last
      // good number instead of "sync failed". It goes stale on its own if the
      // hold persists, which is the honest signal.
      if (error instanceof ScanHold) {
        this.metrics.scans.inc({ chain, result: 'suppressed' });
        this.logger.warn(`Scan ${key} held: ${message}`);
      } else {
        this.metrics.scans.inc({ chain, result: 'failed' });
        this.metrics.errors.inc({ type: 'scan' });
        this.logger.warn(`Scan ${key} failed: ${message}`);
        await this.markFailed(group, message);
      }
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * A silently wrong number is worse than a failed request. A source may return
   * partial data (TronGrid without frozenV2, a Chrome scrape reading $0) — visually
   * this is a sharp drop that "recovers" on its own a cycle later, drawing a sawtooth
   * on the chart. So: (1) on a drop of more than 25% we immediately re-check with a
   * second scan; (2) if that one is low too, we trust the drop only when it holds for
   * `dropConfirmCycles` cycles in a row, otherwise we throw (the wallet stays stale
   * with its old value and NO snapshot is written). A real withdrawal still gets
   * recorded this way — just not instantly; a one-off glitch never does.
   */
  private async scanWithSanityCheck(
    key: string,
    chain: Chain,
    address: string,
    previousTotal: number | null,
  ): Promise<ScanResult> {
    const first = await scanQueue.run(chain, () => scanAddress(chain, address));

    // nothing to compare against (first successful scan or a nearly empty wallet)
    if (previousTotal === null || previousTotal <= 10) {
      this.dropStreak.delete(key);
      return first;
    }

    const FLOOR = previousTotal * 0.75; // a drop of more than 25% in one cycle is suspicious
    if (first.totalUsd >= FLOOR) {
      this.dropStreak.delete(key); // normal or up
      return first;
    }

    this.logger.warn(
      `Suspicious drop ${chain}:${address}: $${previousTotal.toFixed(2)} → $${first.totalUsd.toFixed(2)}, re-checking`,
    );
    const second = await scanQueue.run(chain, () => scanAddress(chain, address));
    if (second.totalUsd >= FLOOR) {
      this.dropStreak.delete(key); // the first reading was a glitch, the second is normal
      return second;
    }

    // both readings are low: either a real withdrawal or a persistent source failure
    const streak = (this.dropStreak.get(key) ?? 0) + 1;
    if (streak >= config.dropConfirmCycles) {
      this.dropStreak.delete(key);
      return second.totalUsd >= first.totalUsd ? second : first; // conservative — pick the larger
    }
    this.dropStreak.set(key, streak);
    throw new ScanHold(
      `Unconfirmed drop ${chain}:${address}: $${previousTotal.toFixed(2)} → $${first.totalUsd.toFixed(2)} (${streak}/${config.dropConfirmCycles}), keeping last known`,
    );
  }

  private async applyResult(group: Wallet[], result: ScanResult): Promise<void> {
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
          data: { walletId: wallet.id, totalUsd: result.totalUsd, breakdown: result.breakdown },
        }),
      ]);
    }
  }

  /** We deliberately leave the last successful cached value untouched — it's served with a stale flag */
  private async markFailed(group: Wallet[], message: string): Promise<void> {
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
