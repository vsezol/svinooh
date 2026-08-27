import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';

export const RABBIT_URL = Symbol('RABBIT_URL');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Consumer {
  handler: (message: unknown) => Promise<void>;
  prefetch: number;
  attached: boolean;
}

/**
 * A thin wrapper over RabbitMQ (amqplib), shared by every service that either
 * fills a queue or works through one.
 *
 * Durable queues, manual ack, and a reconnect loop that re-asserts every queue
 * and re-attaches every consumer — a broker restart should cost a few seconds,
 * not a deploy. Without a URL it is simply disabled, and the services fall back
 * to running the same pipeline in-process, which is what makes local
 * development work without a broker.
 */
@Injectable()
export class RabbitService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private conn: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: amqp.Channel | null = null;
  private readonly consumers = new Map<string, Consumer>();
  /** attachAll is async and re-entrant; without this, registering four queues
   *  in a loop starts four passes that all see the same queue as unattached and
   *  subscribe to it four times over */
  private attaching: Promise<void> | null = null;
  private closing = false;

  constructor(@Inject(RABBIT_URL) private readonly url: string | null) {}

  get enabled(): boolean {
    return !!this.url;
  }

  async onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('RABBITMQ_URL not set — queue disabled (running in-process)');
      return;
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closing) return;
    try {
      this.conn = await amqp.connect(this.url as string);
      this.conn.on('error', () => {});
      this.conn.on('close', () => {
        if (this.closing) return;
        this.channel = null;
        this.conn = null;
        for (const entry of this.consumers.values()) entry.attached = false;
        this.logger.warn('RabbitMQ connection closed — reconnecting');
        void this.reconnect();
      });
      this.channel = await this.conn.createChannel();
      this.logger.log('RabbitMQ connected');
      await this.attachAll();
    } catch (e) {
      this.logger.warn(`RabbitMQ connect failed: ${e instanceof Error ? e.message : e}`);
      await this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (this.closing) return;
    await sleep(3000);
    await this.connect();
  }

  async publish(queue: string, message: unknown): Promise<void> {
    if (!this.channel) return;
    await this.channel.assertQueue(queue, { durable: true });
    this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  /** How many messages are waiting across these queues (0 if the connection is down) */
  async messageCount(queues: string[]): Promise<number> {
    if (!this.channel) return 0;
    let total = 0;
    for (const queue of queues) {
      try {
        const q = await this.channel.checkQueue(queue);
        total += q.messageCount;
      } catch {
        // a queue nobody has declared yet holds nothing
      }
    }
    return total;
  }

  consume<T>(queue: string, handler: (message: T) => Promise<void>, prefetch: number): void {
    this.consumers.set(queue, {
      handler: handler as (m: unknown) => Promise<void>,
      prefetch,
      attached: false,
    });
    if (this.channel) void this.attachAll();
  }

  /**
   * Each queue gets its own channel, because prefetch is a property of the
   * channel: sharing one would give every queue the smallest prefetch any of
   * them asked for.
   */
  private attachAll(): Promise<void> {
    this.attaching = (this.attaching ?? Promise.resolve()).then(() => this.attachPending());
    return this.attaching;
  }

  private async attachPending(): Promise<void> {
    if (!this.conn) return;
    for (const [queue, entry] of this.consumers) {
      if (entry.attached) continue;
      try {
        const channel = await this.conn.createChannel();
        await channel.assertQueue(queue, { durable: true });
        await channel.prefetch(entry.prefetch);
        await channel.consume(queue, (msg) => {
          if (msg) void this.handle(channel, entry.handler, msg);
        });
        entry.attached = true;
        this.logger.log(`Consuming ${queue} (prefetch ${entry.prefetch})`);
      } catch (e) {
        this.logger.warn(`Could not consume ${queue}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private async handle(
    channel: amqp.Channel,
    handler: (message: unknown) => Promise<void>,
    msg: amqp.ConsumeMessage,
  ): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(msg.content.toString());
    } catch {
      channel.ack(msg); // garbage — drop it rather than redeliver it forever
      return;
    }
    try {
      await handler(message);
    } catch (e) {
      this.logger.warn(`Message from ${msg.fields.routingKey} failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      // Always ack. A scan that failed is re-enqueued by the next top-up with
      // fresh information; redelivering the old job would only retry the same
      // thing against the same broken source, faster.
      channel.ack(msg);
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    try {
      await this.channel?.close();
      await this.conn?.close();
    } catch {
      // ignore
    }
  }
}
