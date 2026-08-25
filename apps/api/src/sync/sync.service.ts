import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Wallet } from '@prisma/client';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma.service';
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

  /** All unique addresses (chain:address) as queue jobs */
  async listGroups(): Promise<ScanJob[]> {
    const wallets = await this.prisma.wallet.findMany({ select: { chain: true, address: true } });
    const seen = new Set<string>();
    const jobs: ScanJob[] = [];
    for (const w of wallets) {
      const key = `${w.chain}:${w.address}`;
      if (!seen.has(key)) {
        seen.add(key);
        jobs.push({ chain: w.chain, address: w.address });
      }
    }
    return jobs;
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
      // a suppressed drop is protection against the "sawtooth", not a real failure
      const suppressed = message.startsWith('Unconfirmed drop');
      this.metrics.scans.inc({ chain, result: suppressed ? 'suppressed' : 'failed' });
      if (!suppressed) this.metrics.errors.inc({ type: 'scan' });
      this.logger.warn(`Scan ${key} failed: ${message}`);
      await this.markFailed(group, message);
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
    throw new Error(
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
            amount: p.amount ?? null,
            priceUsd: p.priceUsd ?? null,
            valueUsd: p.valueUsd,
            platform: p.platform ?? null,
            category: p.category,
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
