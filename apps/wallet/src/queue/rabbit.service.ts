import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { config } from '../config';
import { sleep } from '../common/util';

export interface ScanJob {
  chain: string;
  address: string;
}

/**
 * A thin wrapper over RabbitMQ (amqplib): a single durable queue of wallet
 * scans. The producer pours addresses into it, the consumer works through them
 * one by one. Without RABBITMQ_URL the service is disabled — scanning runs
 * in-process (see ScanProducer). It reconnects on its own when the connection drops.
 */
@Injectable()
export class RabbitService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private conn: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: amqp.Channel | null = null;
  private handler: ((job: ScanJob) => Promise<void>) | null = null;
  private prefetch = 1;
  private consuming = false;
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
        this.consuming = false;
        this.logger.warn('RabbitMQ connection closed — reconnecting');
        void this.reconnect();
      });
      this.channel = await this.conn.createChannel();
      await this.channel.assertQueue(config.scanQueueName, { durable: true });
      await this.channel.prefetch(this.prefetch);
      this.logger.log('RabbitMQ connected');
      if (this.handler) await this.startConsuming();
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

  async enqueue(job: ScanJob): Promise<void> {
    if (!this.channel) return;
    this.channel.sendToQueue(config.scanQueueName, Buffer.from(JSON.stringify(job)), {
      persistent: true,
    });
  }

  /** How many messages are waiting in the queue (0 if the connection is down) */
  async messageCount(): Promise<number> {
    if (!this.channel) return 0;
    try {
      const q = await this.channel.checkQueue(config.scanQueueName);
      return q.messageCount;
    } catch {
      return 0;
    }
  }

  registerConsumer(handler: (job: ScanJob) => Promise<void>, prefetch: number): void {
    this.handler = handler;
    this.prefetch = prefetch;
    if (this.channel) void this.startConsuming();
  }

  private async startConsuming(): Promise<void> {
    if (!this.channel || !this.handler || this.consuming) return;
    this.consuming = true;
    await this.channel.prefetch(this.prefetch);
    await this.channel.consume(config.scanQueueName, (msg) => {
      if (msg) void this.handle(msg);
    });
  }

  private async handle(msg: amqp.ConsumeMessage): Promise<void> {
    let job: ScanJob | null = null;
    try {
      job = JSON.parse(msg.content.toString()) as ScanJob;
    } catch {
      this.channel?.ack(msg); // garbage — drop it
      return;
    }
    try {
      await this.handler?.(job);
    } catch (e) {
      this.logger.warn(
        `Job ${job.chain}:${job.address} failed: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      this.channel?.ack(msg); // always ack — the next top-up will re-scan
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
