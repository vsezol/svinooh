import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { scanQueueName, sleep } from '@svinooh/common';
import { RabbitService } from '../queue/rabbit.service';
import { SyncService } from './sync.service';

/**
 * Tops the queue up with the addresses that are DUE for a rescan (SyncService
 * decides which, and in what order). It checks often, but an address that isn't
 * due yet is simply not enqueued — that is what paces us against the upstream
 * sources. Without RabbitMQ it runs the same pipeline in-process so dev works
 * without a broker.
 */
const CHAINS: Chain[] = ['EVM', 'SOL', 'TRON', 'BTC'];
const ALL_QUEUES = CHAINS.map(scanQueueName);

@Injectable()
export class ScanProducerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScanProducerService.name);
  private timer: NodeJS.Timeout | null = null;
  private toppingUp = false;
  private stopped = false;

  constructor(
    private readonly rabbit: RabbitService,
    private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap() {
    if (this.rabbit.enabled) {
      // let the broker/consumer come up, then the first fill + periodic top-ups
      setTimeout(() => void this.topUp(), 8000).unref?.();
      this.timer = setInterval(() => void this.topUp(), config.scanReloadSec * 1000);
      this.timer.unref?.();
      this.logger.log(`Producer: refilling the queue when it drains, checking every ${config.scanReloadSec}s`);
    } else {
      setTimeout(() => void this.inProcessLoop(), 8000).unref?.();
      this.logger.log(`Producer: RabbitMQ off — scanning in-process, pause ${config.scanJobDelayMs}ms`);
    }
  }

  /** Queue is empty → enqueue whatever is due now (possibly nothing) */
  private async topUp(): Promise<void> {
    if (this.toppingUp || this.stopped) return;
    this.toppingUp = true;
    try {
      if ((await this.rabbit.messageCount(ALL_QUEUES)) > 0) return; // still working through it
      const groups = await this.sync.listGroups();
      // Each address goes to the queue for its own chain — see scanQueueName
      for (const job of groups) await this.rabbit.enqueue(scanQueueName(job.chain as Chain), job);
      if (groups.length) this.logger.log(`Enqueued ${groups.length} addresses`);
    } catch (e) {
      this.logger.warn(`topUp failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.toppingUp = false;
    }
  }

  /** Broker-less fallback: the same pipeline, but sequential and with a pause */
  private async inProcessLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const groups = await this.sync.listGroups();
        for (const job of groups) {
          if (this.stopped) break;
          await this.sync.scanOne(job);
          await sleep(config.scanJobDelayMs);
        }
        if (!groups.length) await sleep(5000);
      } catch (e) {
        this.logger.warn(`in-process loop: ${e instanceof Error ? e.message : e}`);
        await sleep(3000);
      }
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
