import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { sleep } from '../common/util';
import { RabbitService } from '../queue/rabbit.service';
import { SyncService } from './sync.service';

/**
 * Заливает адреса кошельков в очередь и, как только она опустела, заливает
 * заново — бесконечный «потихоньку» цикл. Без RabbitMQ гоняет тот же скан
 * in-process (последовательно, с паузой), чтобы дев работал без брокера.
 */
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
      // дать брокеру/консьюмеру подняться, затем первая заливка + периодическая дозаливка
      setTimeout(() => void this.topUp(), 8000).unref?.();
      this.timer = setInterval(() => void this.topUp(), config.scanReloadSec * 1000);
      this.timer.unref?.();
      this.logger.log(`Producer: дозаливка очереди при опустошении, проверка каждые ${config.scanReloadSec}с`);
    } else {
      setTimeout(() => void this.inProcessLoop(), 8000).unref?.();
      this.logger.log(`Producer: RabbitMQ выкл — скан in-process, пауза ${config.scanJobDelayMs}мс`);
    }
  }

  /** Очередь пуста → залить все адреса заново */
  private async topUp(): Promise<void> {
    if (this.toppingUp || this.stopped) return;
    this.toppingUp = true;
    try {
      if ((await this.rabbit.messageCount()) > 0) return; // ещё разгребаем
      const groups = await this.sync.listGroups();
      for (const job of groups) await this.rabbit.enqueue(job);
      if (groups.length) this.logger.log(`Залил в очередь ${groups.length} адресов`);
    } catch (e) {
      this.logger.warn(`topUp упал: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.toppingUp = false;
    }
  }

  /** Фоллбэк без брокера: тот же паровоз, но последовательно и с паузой */
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
        this.logger.warn(`in-process цикл: ${e instanceof Error ? e.message : e}`);
        await sleep(3000);
      }
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
