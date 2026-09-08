import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Wallet } from '@prisma/client';
import {
  agree,
  MetricsService,
  moved,
  RabbitService,
  SCAN_RESULT_QUEUE,
  type ScanOutcome,
} from '@svinooh/common';
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
    // One at a time so results apply in arrival order: two readings of the
    // same address can sit in the queue together (a retry, a late recheck),
    // and interleaved they could let the older one land last and win.
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
      await this.sync.noteUnbelievedReading(wallet.id, verdict.unbelieved);
      this.metrics.scans.inc({ chain: outcome.chain, result: 'suppressed' });
      this.metrics.scanChecks.inc({ tier, result: 'suppressed' });
      return;
    }

    await this.sync.applyResult(wallet, verdict.believe);
    this.metrics.scans.inc({ chain: outcome.chain, result: 'ok' });
    this.metrics.scanChecks.inc({ tier, result: 'ok' });
  }

  /**
   * What to store, and what to remember about having decided it.
   *
   * Pure: it is handed the count of consecutive readings we did not believe and
   * gives back the new one, so the same reasoning holds whether this is the
   * first process to see the address or the fifth after a redeploy. It used to
   * keep that count in a Map of its own, which is why it could only ever run in
   * one place.
   */
  private judge(
    key: string,
    outcome: Extract<ScanOutcome, { ok: true }>,
    wallet: Wallet,
  ): { believe: ScanResult | null; unbelieved: number } {
    const { result, recheck } = outcome;
    const previousTotal = wallet.lastTotalUsd;

    // A total with nothing under it is a shape no scanner can honestly produce
    // — the total IS the sum of the positions' values — so it is judged the way
    // a collapsed total is: doubted, retried, and only believed once it repeats
    // enough times to be a real emptying. The night this mattered, a scan bug
    // wiped every stored position of a five-figure wallet while its total
    // sailed through this gate untouched.
    if (result.totalUsd > 10 && result.positions.length === 0) {
      const streak = wallet.unbelievedReadings + 1;
      if (streak < config.dropConfirmCycles) {
        this.logger.warn(
          `Positionless total ${key}: $${result.totalUsd.toFixed(2)} with 0 positions (${streak}/${config.dropConfirmCycles}), keeping last known`,
        );
        return { believe: null, unbelieved: streak };
      }
      return { believe: result, unbelieved: 0 };
    }

    // Nothing to compare against: the first successful scan of an address has no
    // previous level, so there is no move to doubt and the reading stands.
    //
    // A near-empty wallet used to be let through here too, on the reasoning that
    // a few dollars is not worth arbitrating. That was the door $449,833 walked
    // through onto a $7 address on 2026-09-08 — a wallet with nothing in it is
    // precisely where somebody else's balance is least believable, not most.
    if (previousTotal === null) {
      return { believe: result, unbelieved: 0 };
    }

    if (!moved(previousTotal, result.totalUsd)) {
      return { believe: result, unbelieved: 0 }; // still about where it was
    }

    /**
     * The move has to be corroborated.
     *
     * The scanner re-reads the address when it sees one, so there are usually
     * two readings taken seconds apart. Two readings that AGREE are evidence;
     * one reading on its own is not, whichever direction it points.
     *
     * This used to accept `recheck` on the single test that it was not itself a
     * drop — no upper bound at all. On 2026-09-08 a re-read of a $7 wallet came
     * back $1,166,714 and that line stored it, whereupon the drop confirmation
     * spent the next twenty-five minutes protecting it and rejecting the truth.
     * A re-read exists to confirm or deny a move, and a third, different number
     * does neither.
     */
    if (recheck && agree(result.totalUsd, recheck.totalUsd)) {
      // Of two readings that agree, the lower: they differ by definition, and
      // understating for one more cycle is the mistake that corrects itself
      const believe = recheck.totalUsd < result.totalUsd ? recheck : result;
      return { believe, unbelieved: 0 };
    }

    const streak = wallet.unbelievedReadings + 1;
    const direction = result.totalUsd > previousTotal ? 'rise' : 'drop';
    if (streak >= config.dropConfirmCycles) {
      // Held long enough that the source is saying something, even if it cannot
      // say it twice the same way. Take the most conservative reading on the
      // table — the smallest — so a run of noise can never ratchet a wallet up.
      const believe = recheck && recheck.totalUsd < result.totalUsd ? recheck : result;
      this.logger.warn(
        `Unconfirmed ${direction} ${key}: settling on $${believe.totalUsd.toFixed(2)} after ${streak} unconfirmed readings`,
      );
      return { believe, unbelieved: 0 };
    }
    this.logger.warn(
      `Unconfirmed ${direction} ${key}: $${previousTotal.toFixed(2)} → $${result.totalUsd.toFixed(2)}` +
        (recheck ? `, re-read $${recheck.totalUsd.toFixed(2)}` : ', not re-read') +
        ` (${streak}/${config.dropConfirmCycles}), keeping last known`,
    );
    return { believe: null, unbelieved: streak };
  }
}
