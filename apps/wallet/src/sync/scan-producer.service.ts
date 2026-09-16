import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Chain } from '@svinooh/shared';
import {
  queueDepth,
  QueueService,
  SCAN_MAX_PRIORITY,
  scanQueueName,
  type ScanJob,
  setting,
} from '@svinooh/common';
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
    private readonly queues: QueueService,
    private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap() {
    if (this.queues.enabled) {
      this.logger.log(`Producer: topping the queue up every ${setting('scan.reloadSec')}s`);
    } else {
      this.logger.error(
        'No queue configured (QUEUE_DRIVER with REDIS_URL or RABBITMQ_URL) — nothing will be scanned. Start RabbitMQ (docker compose up -d rabbitmq), or set QUEUE_DRIVER=redis with REDIS_URL',
      );
    }
  }

  /**
   * One pass: dispatch what is due, per queue.
   *
   * Per queue, because the old rule was "top up nothing while ANY queue holds
   * anything" — so one wedged EVM job stopped BTC, SOL and TRON from being
   * refilled at all, and the whole system's cadence was set by its slowest
   * chain. Each queue is now filled to its own target and nobody waits on
   * anybody.
   *
   * There is no sweep any more. An address whose scan never came back is not a
   * special case to be noticed and repaired — its lease simply runs out and it
   * comes due again, which is what a lease is for.
   */
  @Interval('scan-top-up', setting('scan.reloadSec') * 1000)
  async tick(): Promise<void> {
    if (this.ticking || !this.queues.enabled) return;
    this.ticking = true;
    try {
      await this.topUp();
    } catch (e) {
      this.logger.warn(`tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }

  private async topUp(): Promise<void> {
    const depth = new Map(CHAINS.map((chain) => [chain, queueDepth(chain)]));
    // Enough for every queue to reach its own depth, if they all happen to be empty
    const due = await this.sync.dueForScan([...depth.values()].reduce((a, b) => a + b, 0));
    if (!due.length) return;

    let dispatched = 0;
    for (const chain of CHAINS) {
      const queue = scanQueueName(chain);
      const room = (depth.get(chain) ?? 1) - (await this.queues.messageCount([queue]));
      if (room <= 0) continue;

      // Urgent first: somebody pasted an address and is watching a spinner
      const batch = due
        .filter((job) => job.chain === chain)
        .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent'))
        .slice(0, room);
      if (!batch.length) continue;

      // Held before publishing, so a tick landing on top of the api's forced
      // scan cannot dispatch the same address twice
      await this.sync.lease(batch);
      for (const job of batch) {
        const priority = job.priority === 'urgent' ? SCAN_MAX_PRIORITY : 0;
        if (!(await this.queues.publish(queue, job, { priority }))) {
          this.logger.warn('Broker would not take the job — stopping this top-up');
          return;
        }
        dispatched++;
      }
    }
    if (dispatched) this.logger.log(`Dispatched ${dispatched} of ${due.length} due addresses`);
  }
}
