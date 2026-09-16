import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { PublishOptions, QueueConfig, QueueDriver, QueueDriverName } from './queue';

export const QUEUE_CONFIG = Symbol('QUEUE_CONFIG');

/**
 * The queue, as every service sees it: publish, consume, and how much is waiting.
 *
 * It hands everything to the driver its config names, and requires only that
 * driver's module — a process on Redis never loads amqplib, one on RabbitMQ never
 * loads ioredis. Without a config it is disabled: publish reports false, nothing
 * is consumed, and `enabled` is how a service finds out it has nothing to do.
 *
 * A plain class as much as a Nest provider: monitor-alerts and bot-telegram
 * construct it themselves and call the lifecycle hooks by hand.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly driver: QueueDriver | null;

  constructor(@Inject(QUEUE_CONFIG) private readonly config: QueueConfig | null) {
    this.driver = config ? loadDriver(config) : null;
  }

  get enabled(): boolean {
    return this.driver !== null;
  }

  /** Which driver carries the queue, or null when there is none */
  get driverName(): QueueDriverName | null {
    return this.config?.driver ?? null;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.driver) {
      this.logger.log('No queue configured (QUEUE_DRIVER with REDIS_URL or RABBITMQ_URL) — queue disabled');
      return;
    }
    await this.driver.start();
  }

  /**
   * Hands a message to the queue, and says whether it got there. It never
   * throws: a caller that took something out on the strength of a publish (a
   * scan claim, say) needs an answer it can act on, not an exception to unwind.
   */
  publish(queue: string, message: unknown, options: PublishOptions = {}): Promise<boolean> {
    return this.driver ? this.driver.publish(queue, message, options) : Promise.resolve(false);
  }

  /** How many messages are waiting across these queues, not counting any being worked on */
  messageCount(queues: string[]): Promise<number> {
    return this.driver ? this.driver.messageCount(queues) : Promise.resolve(0);
  }

  /** `prefetch` is how many of this queue's messages this process works on at once */
  consume<T>(queue: string, handler: (message: T) => Promise<void>, prefetch: number): void {
    this.driver?.consume(queue, handler as (message: unknown) => Promise<void>, prefetch);
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.stop();
  }
}

/** Only the chosen driver's client library is ever loaded */
function loadDriver(config: QueueConfig): QueueDriver {
  if (config.driver === 'redis') {
    const { RedisDriver } = require('./redis.driver') as typeof import('./redis.driver');
    return new RedisDriver(config.url);
  }
  const { RabbitDriver } = require('./rabbit.driver') as typeof import('./rabbit.driver');
  return new RabbitDriver(config.url);
}
