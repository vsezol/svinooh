import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Wallet } from '@prisma/client';
import { MetricsService, RabbitService, SCAN_RESULT_QUEUE, type ScanOutcome } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { ScanResult } from '@svinooh/shared';
import { config } from '../config';
import { SyncService } from './sync.service';

/**
 * The only thing in the system that writes what a wallet is worth.
 *
 * Scanners are interchangeable and can be run several at a time; deciding what
 * to believe is not, so it happens here, once, in one process. A scanner hands
 * over readings. This decides whether they are worth storing.
 *
 * A silently wrong number is worse than a failed request. A source can return
 * partial data — TronGrid without frozenV2, a page that rendered before its
 * chains resolved — and on a chart that looks like a cliff that heals itself an
 * hour later. So a drop of more than 25% has to survive two readings taken
 * apart (the scanner takes the second) and then hold for `dropConfirmCycles`
 * cycles before it is written. A real withdrawal still lands, just not
 * instantly. A glitch never does.
 */
@Injectable()
export class ScanResultConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanResultConsumerService.name);
  /** Consecutive unconfirmed drops per address — the reason this consumer is single */
  private readonly dropStreak = new Map<string, number>();

  constructor(
    private readonly rabbit: RabbitService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.rabbit.enabled) return;
    // Deliberately one at a time. Two wallets in the same portfolio landing at
    // once would race on the portfolio snapshot, and the work here is a few
    // updates — there is nothing to gain by parallelising it.
    this.rabbit.consume<ScanOutcome>(SCAN_RESULT_QUEUE, (o) => this.apply(o), 1);
    this.logger.log(`Consuming ${SCAN_RESULT_QUEUE} — the single writer of wallet values`);
  }

  /**
   * A result arrived, so whatever we do with it, this address is no longer on
   * its way — the claim is released on every path out of here, including the
   * ones that write nothing.
   */
  async apply(outcome: ScanOutcome): Promise<void> {
    try {
      await this.store(outcome);
    } finally {
      await this.sync.releaseScan(outcome.chain, outcome.address);
    }
  }

  private async store(outcome: ScanOutcome): Promise<void> {
    const key = `${outcome.chain}:${outcome.address}`;
    const wallets = await this.prisma.wallet.findMany({
      where: { chain: outcome.chain, address: outcome.address },
    });
    if (!wallets.length) return; // removed while the scan was in flight

    if (!outcome.ok) {
      this.metrics.scans.inc({ chain: outcome.chain, result: 'failed' });
      this.metrics.errors.inc({ type: 'scan' });
      this.logger.warn(`Scan ${key} failed: ${outcome.error}`);
      await this.sync.markFailed(wallets, outcome.error);
      return;
    }

    const believable = this.judge(key, outcome, wallets);
    if (!believable) {
      // Our own decision, not a broken source: leave the wallet exactly as it
      // was — status, value and all — so the page keeps showing the last good
      // number instead of "sync failed". It goes stale on its own if this
      // persists, which is the honest signal.
      this.metrics.scans.inc({ chain: outcome.chain, result: 'suppressed' });
      return;
    }

    await this.sync.applyResult(wallets, believable);
    this.metrics.scans.inc({ chain: outcome.chain, result: 'ok' });
    for (const portfolioId of new Set(wallets.map((w) => w.portfolioId))) {
      await this.sync.snapshotPortfolio(portfolioId);
    }
  }

  /** The reading worth storing, or null to keep what is already there */
  private judge(key: string, outcome: Extract<ScanOutcome, { ok: true }>, wallets: Wallet[]): ScanResult | null {
    const { result, recheck } = outcome;
    const previousTotal = wallets.map((w) => w.lastTotalUsd).find((v) => v !== null) ?? null;

    // nothing to compare against (first successful scan, or a nearly empty wallet)
    if (previousTotal === null || previousTotal <= 10) {
      this.dropStreak.delete(key);
      return result;
    }

    const floor = previousTotal * 0.75; // a fall of more than 25% in one cycle is suspicious
    if (result.totalUsd >= floor) {
      this.dropStreak.delete(key); // normal, or up
      return result;
    }
    if (recheck && recheck.totalUsd >= floor) {
      this.dropStreak.delete(key); // the first reading was a glitch, the second is normal
      return recheck;
    }

    // both readings are low: either a real withdrawal or a source that keeps failing
    const streak = (this.dropStreak.get(key) ?? 0) + 1;
    if (streak >= config.dropConfirmCycles) {
      this.dropStreak.delete(key);
      // conservative: of two low readings, keep the larger
      return recheck && recheck.totalUsd > result.totalUsd ? recheck : result;
    }
    this.dropStreak.set(key, streak);
    this.logger.warn(
      `Unconfirmed drop ${key}: $${previousTotal.toFixed(2)} → $${result.totalUsd.toFixed(2)} (${streak}/${config.dropConfirmCycles}), keeping last known`,
    );
    return null;
  }
}
