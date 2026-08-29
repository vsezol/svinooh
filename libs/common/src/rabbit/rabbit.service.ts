import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { Options } from 'amqplib';
import { PRIORITY_QUEUE_PREFIX, SCAN_MAX_PRIORITY } from '../scan-contract';

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
/** What a caller can ask of a single publish */
export interface PublishOptions {
  /** 0 is ordinary; anything higher jumps the queue, up to its declared maximum */
  priority?: number;
}

/**
 * How a queue is declared — the one place that decides, because a queue's
 * arguments are fixed at declaration and every later declare must match them
 * exactly. A mismatch is a PRECONDITION_FAILED, which is a channel-level
 * exception: it kills the shared channel and takes the connection into a
 * reconnect loop. Publishing, counting and consuming all come through here so
 * they cannot drift apart.
 */
function queueOptions(queue: string): Options.AssertQueue {
  return queue.startsWith(PRIORITY_QUEUE_PREFIX)
    ? { durable: true, arguments: { 'x-max-priority': SCAN_MAX_PRIORITY } }
    : { durable: true };
}

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
      const channel = await this.conn.createChannel();
      this.channel = channel;
      // A channel error must not surface as an unhandled 'error' event (Node
      // throws on those), and a main channel that closes under us must not leave
      // publish() writing into a dead one — drop it and let the connection's own
      // close/reconnect below rebuild everything from scratch.
      channel.on('error', () => {});
      channel.on('close', () => {
        if (this.closing || this.channel !== channel) return;
        this.channel = null;
        void this.conn?.close().catch(() => {});
      });
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

  /**
   * Hands a message to the broker, and says whether it got there.
   *
   * It still never throws — a failed publish is not worth unwinding a caller's
   * enqueue loop, and the next top-up re-enqueues whatever is still due with
   * fresh state. But it has to be answerable: a caller that took something out
   * on the strength of this publish (a scan claim, say) needs to put it back
   * rather than leave an address marked as being worked on by a job that was
   * never sent. A disconnected client is `false`, not a silent success.
   */
  async publish(queue: string, message: unknown, options: PublishOptions = {}): Promise<boolean> {
    const channel = this.channel;
    if (!channel) return false;
    try {
      await channel.assertQueue(queue, queueOptions(queue));
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        ...(options.priority === undefined ? {} : { priority: options.priority }),
      });
      return true;
    } catch (e) {
      this.logger.warn(`Publish to ${queue} failed: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** How many messages are waiting across these queues (0 if the connection is down) */
  async messageCount(queues: string[]): Promise<number> {
    const channel = this.channel;
    if (!channel) return 0;
    let total = 0;
    for (const queue of queues) {
      try {
        // assertQueue, NOT checkQueue. checkQueue is a *passive* declare, and a
        // passive declare of a queue that does not exist yet is a channel-level
        // exception — it kills this shared channel, and the connection with it.
        // That is exactly how a producer (wallet) whose consumer service
        // (scanner-evm) had not been deployed took the whole broker connection
        // into a 6-second reconnect loop. assertQueue is idempotent: it reports
        // the depth and, if the queue is missing, creates it durable — the same
        // declaration every producer and consumer here already makes — so a
        // missing consumer degrades to "jobs pile up" instead of "nothing runs".
        const q = await channel.assertQueue(queue, queueOptions(queue));
        total += q.messageCount;
      } catch {
        // a queue we still cannot assert contributes nothing, and must not
        // abort the count for the others
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
        channel.on('error', () => {});
        // If this consumer's own channel closes, mark it unattached so a later
        // attachAll (on reconnect) re-subscribes it, rather than leaving a
        // consumer that has quietly stopped receiving.
        channel.on('close', () => {
          entry.attached = false;
        });
        await channel.assertQueue(queue, queueOptions(queue));
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
      this.safeAck(channel, msg); // garbage — drop it rather than redeliver it forever
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
      this.safeAck(channel, msg);
    }
  }

  /**
   * ack that cannot crash the process. The channel can close under us between
   * receiving a message and acking it — a shutdown, a reconnect — and an ack on
   * a closed channel throws IllegalOperationError, which as an uncaught async
   * rejection took the whole scanner down. The message stays unacked, so the
   * broker redelivers it on the next connection.
   */
  private safeAck(channel: amqp.Channel, msg: amqp.ConsumeMessage): void {
    try {
      channel.ack(msg);
    } catch {
      // channel already gone — leave it for redelivery
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
