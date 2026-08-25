import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config';
import { sleep } from '../common/util';
import type { ScanJob } from '../queue/rabbit.service';
import { RabbitService } from '../queue/rabbit.service';
import { SyncService } from './sync.service';

/**
 * Works through the queue one address at a time (prefetch=1) and pauses after
 * each scan — a steady "slow and steady", without bursts of requests to sources.
 */
@Injectable()
export class ScanConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanConsumerService.name);

  constructor(
    private readonly rabbit: RabbitService,
    private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap() {
    if (!this.rabbit.enabled) return;
    this.rabbit.registerConsumer((job) => this.handle(job), config.scanPrefetch);
    this.logger.log(
      `Consumer: prefetch=${config.scanPrefetch}, ${config.scanJobDelayMs}ms pause between scans`,
    );
  }

  private async handle(job: ScanJob): Promise<void> {
    await this.sync.scanOne(job);
    await sleep(config.scanJobDelayMs); // keep the slot busy during the pause — that's the pacing
  }
}
