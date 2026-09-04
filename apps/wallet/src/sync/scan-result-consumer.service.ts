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

  constructor(
    private readonly rabbit: RabbitService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.rabbit.enabled) return;
    // Still one at a time, but for one reason now rather than two: two
    // addresses in the same portfolio landing together would race on that
    // portfolio's snapshot, which is a read-then-write. The other reason — a
    // streak counter that only existed in this process's memory — is gone.
    this.rabbit.consume<ScanOutcome>(SCAN_RESULT_QUEUE, (o) => this.apply(o), 1);
    this.logger.log(`Consuming ${SCAN_RESULT_QUEUE} — the single writer of wallet values`);
  }

  /**
   * A result arrived.
   *
   * Nothing to release: the lease taken at dispatch is a due time like any
   * other, and storing the result writes the real one over it. A path that
   * writes nothing — a reading we chose not to believe — leaves the lease
   * standing, which is the backoff that case wanted anyway.
   */
  async apply(outcome: ScanOutcome): Promise<void> {
    await this.store(outcome);
  }

  private async store(outcome: ScanOutcome): Promise<void> {
    const key = `${outcome.chain}:${outcome.address}`;
    const wallet = await this.prisma.wallet.findUnique({
      where: { chain_address: { chain: outcome.chain, address: outcome.address } },
    });
    if (!wallet) return; // removed while the scan was in flight

    // Read before applyResult writes lastSyncedAt, or a first scan would
    // stop looking like one by the time it is counted
    const tier = await this.sync.tierOf(wallet);

    if (!outcome.ok) {
      this.metrics.scans.inc({ chain: outcome.chain, result: 'failed' });
      this.metrics.scanChecks.inc({ tier, result: 'failed' });
      this.metrics.errors.inc({ type: 'scan' });
      this.logger.warn(`Scan ${key} failed: ${outcome.error}`);
      await this.sync.markFailed(wallet, outcome.error);
      return;
    }

    const verdict = this.judge(key, outcome, wallet);
    if (!verdict.believe) {
      // Our own decision, not a broken source: leave the wallet's value exactly
      // as it was — status and all — so the page keeps showing the last good
      // number instead of "sync failed". It goes stale on its own if this
      // persists, which is the honest signal. Only the count of how many times
      // we have now seen this is written down.
      await this.sync.noteLowReading(wallet.id, verdict.lowReadings);
      this.metrics.scans.inc({ chain: outcome.chain, result: 'suppressed' });
      this.metrics.scanChecks.inc({ tier, result: 'suppressed' });
      return;
    }

    await this.sync.applyResult(wallet, verdict.believe);
    this.metrics.scans.inc({ chain: outcome.chain, result: 'ok' });
    this.metrics.scanChecks.inc({ tier, result: 'ok' });
    // One address, and every portfolio that happens to hold it — its total just
    // moved for all of them
    for (const portfolioId of await this.sync.portfoliosHolding(wallet.id)) {
      await this.sync.snapshotPortfolio(portfolioId);
    }
  }

  /**
   * What to store, and what to remember about having decided it.
   *
   * Pure: it is handed the count of consecutive low readings and gives back the
   * new one, so the same reasoning holds whether this is the first process to
   * see the address or the fifth after a redeploy. It used to keep that count
   * in a Map of its own, which is why it could only ever run in one place.
   */
  private judge(
    key: string,
    outcome: Extract<ScanOutcome, { ok: true }>,
    wallet: Wallet,
  ): { believe: ScanResult | null; lowReadings: number } {
    const { result, recheck } = outcome;
    const previousTotal = wallet.lastTotalUsd;

    // A total with nothing under it is a shape no scanner can honestly produce
    // — the total IS the sum of the positions' values — so it is judged the way
    // a collapsed total is: doubted, retried, and only believed once it repeats
    // enough times to be a real emptying. The night this mattered, a scan bug
    // wiped every stored position of a five-figure wallet while its total
    // sailed through this gate untouched.
    if (result.totalUsd > 10 && result.positions.length === 0) {
      const streak = wallet.lowReadings + 1;
      if (streak < config.dropConfirmCycles) {
        this.logger.warn(
          `Positionless total ${key}: $${result.totalUsd.toFixed(2)} with 0 positions (${streak}/${config.dropConfirmCycles}), keeping last known`,
        );
        return { believe: null, lowReadings: streak };
      }
      return { believe: result, lowReadings: 0 };
    }

    // nothing to compare against (first successful scan, or a nearly empty wallet)
    if (previousTotal === null || previousTotal <= 10) {
      return { believe: result, lowReadings: 0 };
    }

    const floor = previousTotal * 0.75; // a fall of more than 25% in one cycle is suspicious
    if (result.totalUsd >= floor) {
      return { believe: result, lowReadings: 0 }; // normal, or up
    }
    if (recheck && recheck.totalUsd >= floor) {
      // the first reading was a glitch, the second is normal
      return { believe: recheck, lowReadings: 0 };
    }

    // both readings are low: either a real withdrawal or a source that keeps failing
    const streak = wallet.lowReadings + 1;
    if (streak >= config.dropConfirmCycles) {
      // conservative: of two low readings, keep the larger
      const believe = recheck && recheck.totalUsd > result.totalUsd ? recheck : result;
      return { believe, lowReadings: 0 };
    }
    this.logger.warn(
      `Unconfirmed drop ${key}: $${previousTotal.toFixed(2)} → $${result.totalUsd.toFixed(2)} (${streak}/${config.dropConfirmCycles}), keeping last known`,
    );
    return { believe: null, lowReadings: streak };
  }
}
