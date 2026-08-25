import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config';
import { sleep } from '../common/util';
import type { ScanJob } from '../queue/rabbit.service';
import { RabbitService } from '../queue/rabbit.service';
import { SyncService } from './sync.service';

/**
 * Разбирает очередь по одному адресу за раз (prefetch=1) и держит паузу после
 * каждого скана — ровный «потихоньку», без всплесков запросов к источникам.
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
      `Consumer: prefetch=${config.scanPrefetch}, пауза ${config.scanJobDelayMs}мс между сканами`,
    );
  }

  private async handle(job: ScanJob): Promise<void> {
    await this.sync.scanOne(job);
    await sleep(config.scanJobDelayMs); // держим слот занятым, пока пауза — это и есть пейсинг
  }
}
