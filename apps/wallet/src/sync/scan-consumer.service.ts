import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  MetricsService,
  RabbitService,
  scanQueueName,
  SCAN_RESULT_QUEUE,
  sleep,
  type ScanJob,
  type ScanOutcome,
} from '@svinooh/common';
import type { Chain, ScanResult } from '@svinooh/shared';
import { config } from '../config';
import { scanAddress } from '../scanners';
import { scanQueue } from './scan-queue';

/**
 * The chains that need one HTTP request: they are scanned right here, in this
 * process, and their results go onto the same result queue everything else
 * uses. EVM is not among them — it needs a browser and has a service of its own.
 *
 * Going through the queue even though the scan happened in-process is on
 * purpose: one path for applying a result, no special case, and moving any of
 * these chains out to its own service later costs nothing.
 */
const OWN_CHAINS: Chain[] = ['SOL', 'TRON', 'BTC'];

@Injectable()
export class ScanConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanConsumerService.name);

  constructor(
    private readonly rabbit: RabbitService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.rabbit.enabled) return;
    for (const chain of OWN_CHAINS) {
      this.rabbit.consume<ScanJob>(scanQueueName(chain), (job) => this.handle(job), config.scanPrefetch);
    }
    this.logger.log(
      `Consuming ${OWN_CHAINS.map(scanQueueName).join(', ')} at prefetch=${config.scanPrefetch}`,
    );
  }

  private async handle(job: ScanJob): Promise<void> {
    await this.publish(await this.scanInProcess(job));
    await sleep(config.scanJobDelayMs); // keep the slot busy through the pause — that is the pacing
  }

  /** The scan itself, with no queue involved — also the local-development path */
  async scanInProcess(job: ScanJob): Promise<ScanOutcome> {
    const chain = job.chain;
    try {
      const result = await scanQueue.run(chain, () => scanAddress(chain, job.address));
      // Same rule as the EVM scanner applies: read again while we are here, and
      // let the writer decide which reading to believe
      const suspicious =
        job.previousTotal !== null &&
        job.previousTotal > 10 &&
        result.totalUsd < job.previousTotal * 0.75;
      const recheck: ScanResult | null = suspicious
        ? await scanQueue.run(chain, () => scanAddress(chain, job.address))
        : null;
      return { chain, address: job.address, ok: true, result, recheck };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${chain}:${job.address} failed: ${message}`);
      return { chain, address: job.address, ok: false, error: message };
    }
  }

  private publish(outcome: ScanOutcome): Promise<void> {
    return this.rabbit.publish(SCAN_RESULT_QUEUE, outcome);
  }
}
