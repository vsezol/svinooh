import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  MetricsService,
  RabbitService,
  ScanHold,
  scanQueueName,
  SCAN_RESULT_QUEUE,
  sleep,
  type ScanJob,
  type ScanOutcome,
} from '@svinooh/common';
import type { ScanResult } from '@svinooh/shared';
import { config } from '../config';
import { scanEvm } from '../scanners/evm';

/**
 * The whole service, really: take an address off `scan.evm`, scan it, put what
 * came back on `scan.result`.
 *
 * Nothing here decides anything. It does not know what a portfolio is, it never
 * touches the database, and it has no opinion about whether a number is
 * believable — that lives with the one consumer that writes. Which is what
 * makes this safe to run several of: add a replica and it competes for the same
 * queue, with its own browser, and no two of them can disagree about what to
 * store because neither of them stores anything.
 */
@Injectable()
export class ScanConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanConsumerService.name);

  constructor(
    private readonly rabbit: RabbitService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.rabbit.enabled) {
      this.logger.warn('No RABBITMQ_URL — this service has nothing to do without a queue');
      return;
    }
    // One at a time per instance: this process holds a single browser, and two
    // headless Chromes in one container choke each other into returning $0.
    // More throughput is more replicas, not more tabs.
    this.rabbit.consume<ScanJob>(scanQueueName('EVM'), (job) => this.handle(job), 1);
    this.logger.log(`Consuming ${scanQueueName('EVM')} → ${SCAN_RESULT_QUEUE}`);
  }

  private async handle(job: ScanJob): Promise<void> {
    const started = Date.now();
    try {
      const result = await scanEvm(job.address);
      // A drop this steep is usually a source having a bad minute, not money
      // moving. Reading again here costs almost nothing — the browser is open
      // and the page is warm — and it gives the consumer two readings to judge
      // with instead of one. Whether to believe them is not decided here.
      const suspicious =
        job.previousTotal !== null &&
        job.previousTotal > 10 &&
        result.totalUsd < job.previousTotal * 0.75;
      const recheck: ScanResult | null = suspicious ? await scanEvm(job.address) : null;
      if (suspicious) {
        this.logger.warn(
          `Suspicious drop ${job.address}: $${job.previousTotal?.toFixed(2)} → $${result.totalUsd.toFixed(2)}, re-read $${recheck?.totalUsd.toFixed(2)}`,
        );
      }

      await this.publish({ chain: 'EVM', address: job.address, ok: true, result, recheck });
      this.metrics.scans.inc({ chain: 'EVM', result: 'ok' });
      this.logger.log(
        `${job.address}: $${result.totalUsd.toFixed(2)}, ${result.positions.length} positions (${Date.now() - started}ms)`,
      );
    } catch (error) {
      if (error instanceof ScanHold) {
        // A deliberate backoff (DeBank throttled us), NOT a failure. Publishing
        // an ok:false here made the writer mark the wallet "sync failed" and
        // counted a failed scan + an error on every held job — a whole
        // dashboard of red for a pause we chose. So: don't publish, don't count
        // it failed. The address is re-enqueued next cycle; the wallet keeps its
        // last value and goes stale on its own if the hold lasts, which is the
        // honest signal.
        this.metrics.scans.inc({ chain: 'EVM', result: 'held' });
        this.logger.debug?.(`${job.address} held: ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.metrics.scans.inc({ chain: 'EVM', result: 'failed' });
        this.metrics.errors.inc({ type: 'scan' });
        this.logger.warn(`${job.address} failed: ${message}`);
        await this.publish({ chain: 'EVM', address: job.address, ok: false, error: message });
      }
    }
    await sleep(config.scanJobDelayMs); // hold the slot through the pause — that is the pacing
  }

  private publish(outcome: ScanOutcome): Promise<boolean> {
    return this.rabbit.publish(SCAN_RESULT_QUEUE, outcome);
  }
}
