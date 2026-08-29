import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Chain } from '@svinooh/shared';
import { RabbitService, scanQueueName, type ScanJob, setting } from '@svinooh/common';
import { SyncService } from './sync.service';

/**
 * Tops the queue up with the addresses that are DUE for a rescan (SyncService
 * decides which, and in what order). It checks often, but an address that isn't
 * due yet is simply not enqueued — that is what paces us against the upstream
 * sources.
 *
 * Nothing is published without claiming that address first (Wallet.scanQueuedAt),
 * so a scan already on its way — from an earlier tick, or forced by the api the
 * instant somebody added the wallet — is never published a second time.
 *
 * There is one pipeline and this is it. There used to be a second, broker-less
 * one right here, so that `npm run dev` worked without RabbitMQ; it skipped EVM,
 * paced itself off how long each scan took rather than off a clock, and was the
 * only copy nobody ran in production. Running the broker locally is cheaper than
 * keeping a shadow implementation honest — see docker-compose.yml.
 */
const CHAINS: Chain[] = ['EVM', 'SOL', 'TRON', 'BTC'];
const ALL_QUEUES = CHAINS.map(scanQueueName);

@Injectable()
export class ScanProducerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanProducerService.name);
  /**
   * @Interval fires on a timer and does not wait for the previous run, so a tick
   * that outlives its own period would otherwise overlap with the next one.
   */
  private ticking = false;

  constructor(
    private readonly rabbit: RabbitService,
    private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap() {
    if (this.rabbit.enabled) {
      this.logger.log(`Producer: topping the queue up every ${setting('scan.reloadSec')}s`);
    } else {
      this.logger.error(
        'RABBITMQ_URL is not set — nothing will be scanned. Start the broker: docker compose up -d rabbitmq',
      );
    }
  }

  /**
   * One pass: notice what has fallen off the conveyor, then refill.
   *
   * The sweep runs first and outside topUp's queue-depth check — a wallet whose
   * scan never came back has to be given up on whether or not the queue is busy
   * right now, and that check is exactly what would keep skipping it.
   *
   * The first tick lands one interval in, which doubles as the wait the broker
   * and the consumers need to come up.
   */
  @Interval('scan-top-up', setting('scan.reloadSec') * 1000)
  async tick(): Promise<void> {
    if (this.ticking || !this.rabbit.enabled) return;
    this.ticking = true;
    try {
      await this.sweepStuckPending();
      await this.topUp();
    } catch (e) {
      this.logger.warn(`tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Queue is empty → enqueue whatever is due now and nobody else has claimed */
  private async topUp(): Promise<void> {
    if ((await this.rabbit.messageCount(ALL_QUEUES)) > 0) return; // still working through it
    const due = await this.sync.listGroups();
    let enqueued = 0;
    for (const job of due) {
      // listGroups already skips what is on its way, but it read a moment ago
      // and the api can force a scan at any point in between — the claim is the
      // guard, the filter only saves us from asking about addresses it can
      // already tell are busy.
      if (!(await this.sync.claimForScan(job.chain, job.address))) continue;
      if (!(await this.rabbit.publish(scanQueueName(job.chain), job))) {
        // The broker is unreachable, so nothing was queued and nothing is going
        // to release this. Hand it back rather than leave the address looking
        // busy for a whole claim — the rest of this batch is going the same way,
        // so stop here and let the next tick try again against a live channel.
        await this.sync.releaseScan(job.chain, job.address);
        this.logger.warn('Broker would not take the job — stopping this top-up');
        break;
      }
      enqueued++;
    }
    if (enqueued) this.logger.log(`Enqueued ${enqueued} of ${due.length} due addresses`);
  }

  /**
   * Wallets that have been waiting for a first scan that is never coming.
   *
   * A scan can end without a result: a held one (DeBank throttling) is acked and
   * publishes nothing, and a scanner can die mid-page. The address is picked up
   * again once its claim ages out, but the wallet keeps `pending` in the
   * meantime — and `pending` is what the page renders as a spinner and polls
   * every three seconds, so left alone it spins against a portfolio that will
   * never change on its own.
   */
  private async sweepStuckPending(): Promise<void> {
    const stuck = await this.sync.failStuckPending();
    if (stuck) this.logger.warn(`${stuck} wallet(s) gave up waiting for a first scan`);
  }
}
