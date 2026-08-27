import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { scanQueueName, sleep } from '@svinooh/common';
import type { ScanJob } from '../queue/rabbit.service';
import { RabbitService } from '../queue/rabbit.service';
import { SyncService } from './sync.service';

/**
 * Works through the light chains one address at a time (prefetch=1), pausing
 * after each scan — steady, without bursts of requests to the sources.
 *
 * EVM is not among them: it is scanned by its own service, off its own queue.
 * A browser scan takes seconds and used to set the pace for chains that need a
 * single HTTP request.
 */
const OWN_CHAINS: Chain[] = ['SOL', 'TRON', 'BTC'];
@Injectable()
export class ScanConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanConsumerService.name);

  constructor(
    private readonly rabbit: RabbitService,
    private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap() {
    if (!this.rabbit.enabled) return;
    for (const chain of OWN_CHAINS) {
      this.rabbit.registerConsumer(
        scanQueueName(chain),
        (job: ScanJob) => this.handle(job),
        config.scanPrefetch,
      );
    }
    this.logger.log(
      `Consumer: ${OWN_CHAINS.join('/')} at prefetch=${config.scanPrefetch}, ${config.scanJobDelayMs}ms pause between scans`,
    );
  }

  private async handle(job: ScanJob): Promise<void> {
    await this.sync.scanOne(job);
    await sleep(config.scanJobDelayMs); // keep the slot busy during the pause — that's the pacing
  }
}
