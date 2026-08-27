import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { config } from '../config';
import { sleep } from '@svinooh/common';

export interface ScanJob {
  chain: string;
  address: string;
}

/**
 * A thin wrapper over RabbitMQ (amqplib): one durable queue per chain. The
 * producer pours addresses into the queue for their chain, a consumer works
 * through each. Without RABBITMQ_URL the service is disabled — scanning runs
 * in-process (see ScanProducer). It reconnects on its own when the connection
 * drops, and re-asserts every queue and re-attaches every consumer when it does.
 */
@Injectable()
export class RabbitService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private conn: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: amqp.Channel | null = null;
  /** queue name → what to do with a job from it, and how many to take at once */
  private readonly consumers = new Map<
    string,
    { handler: (job: ScanJob) => Promise<void>; prefetch: number; attached: boolean }
  >();
  private closing = false;

  get enabled(): boolean {
    return !!config.rabbitUrl;
  }

  async onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('RABBITMQ_URL not set — queue disabled (scanning in-process)');
      return;
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closing) return;
    try {
      this.conn = await amqp.connect(config.rabbitUrl as string);
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
      for (const entry of this.consumers.values()) entry.attached = false;
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

  async enqueue(queue: string, job: ScanJob): Promise<void> {
    if (!this.channel) return;
    await this.channel.assertQueue(queue, { durable: true });
    this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(job)), { persistent: true });
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

  registerConsumer(queue: string, handler: (job: ScanJob) => Promise<void>, prefetch: number): void {
    this.consumers.set(queue, { handler, prefetch, attached: false });
    if (this.channel) void this.attachAll();
  }

  /**
   * Each queue gets its own channel, because prefetch is a property of the
   * channel: sharing one would make every queue take the smallest prefetch any
   * of them asked for.
   */
  private async attachAll(): Promise<void> {
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
    handler: (job: ScanJob) => Promise<void>,
    msg: amqp.ConsumeMessage,
  ): Promise<void> {
    let job: ScanJob | null = null;
    try {
      job = JSON.parse(msg.content.toString()) as ScanJob;
    } catch {
      channel.ack(msg); // garbage — drop it
      return;
    }
    try {
      await handler(job);
    } catch (e) {
      this.logger.warn(
        `Job ${job.chain}:${job.address} failed: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      channel.ack(msg); // always ack — the next top-up will re-scan
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
