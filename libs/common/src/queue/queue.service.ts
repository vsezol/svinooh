import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { Queue, Worker, type DefaultJobOptions } from "bullmq";
import { Redis } from "ioredis";
import { serviceName } from "../env";

export const QUEUE_URL = Symbol("QUEUE_URL");
export const QUEUE_OPTIONS = Symbol("QUEUE_OPTIONS");

/** What a caller can ask of a single publish */
export interface PublishOptions {
  /** 0 is ordinary; anything higher jumps the queue */
  priority?: number;
}

/** Knobs the tests turn down; production runs on BullMQ's defaults */
export interface QueueOptions {
  /** How long a job stays locked to a worker that stopped renewing (a crash, a kill) before another may take it */
  lockDurationMs?: number;
  /** How often a worker looks for such jobs */
  stalledIntervalMs?: number;
  /** The first retry's delay on the queues that retry; it doubles from there */
  retryDelayMs?: number;
  /** How long a stopping process gives the handlers already running before it lets go of their jobs */
  drainMs?: number;
}

/** Every key the queue makes starts with this, beside anything else sharing the instance (the agent keeps `agent:`) */
const PREFIX = "queue";

/** Failed jobs kept for a look in redis-cli; completed ones go at once */
const KEEP_FAILED = 100;

/**
 * The telegram queues retry: a message to a person is worth delivering late and
 * not worth losing, so a Telegram outage delays it rather than drops it. Ten
 * tries with the delay doubling from two seconds is about half an hour.
 *
 * The scan queues do not. A scan that failed is re-enqueued by the next top-up
 * with fresh information; retrying the old job would only hit the same broken
 * source again, faster.
 */
const RETRIES = 10;
const RETRY_DELAY_MS = 2_000;
const retried = (queue: string): boolean => queue.endsWith(".telegram");

const DRAIN_MS = 5_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Consumer {
  queue: string;
  handler: (message: unknown) => Promise<void>;
  prefetch: number;
  worker: Worker | null;
  /** Handlers running now — what a shutdown waits for */
  working: number;
}

/**
 * The queue between services — scan jobs out, scan results back, and the things
 * somebody has to be told — on BullMQ over Redis.
 *
 * Every queue is a BullMQ queue; every consumer is a Worker with the prefetch as
 * its concurrency. What used to be hand-written on Redis Streams is the library's
 * job now: a worker renews the lock on what it holds, so a slow handler is never
 * mistaken for a dead one, and a job whose worker stopped renewing — a deploy, a
 * crash — goes back to waiting for another worker to pick up.
 *
 * Without a URL it is disabled: publish reports false, nothing is consumed, and
 * `enabled` is how a service finds out it has nothing to do. publish() never
 * throws — a caller that took something out on the strength of a publish (a
 * scan claim, say) needs an answer it can act on, not an exception to unwind.
 *
 * A plain class as much as a Nest provider: bot-telegram constructs it itself
 * and calls the lifecycle hooks by hand.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly consumers = new Map<string, Consumer>();
  private readonly queues = new Map<string, Queue>();
  private readonly options: QueueOptions;
  private client: Redis | null = null;
  private closing = false;

  constructor(
    @Inject(QUEUE_URL) private readonly url: string | null,
    @Optional() @Inject(QUEUE_OPTIONS) options: QueueOptions = {},
  ) {
    this.options = options;
  }

  get enabled(): boolean {
    return !!this.url;
  }

  /** Resolves once connected; ioredis retries a Redis that is down until it is not */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.url) {
      this.logger.log("REDIS_URL not set — queue disabled");
      return;
    }
    if (this.client || this.closing) return;
    const client = new Redis(this.url, {
      connectionName: `${serviceName()}:queue`,
      // Railway's private network resolves over IPv6, and ioredis looks up IPv4
      // only unless told otherwise
      family: 0,
      // What BullMQ's workers require: a command waits for the connection to
      // come back rather than failing. publish() and messageCount() check the
      // status first, so no caller is kept waiting on a queue that is not there.
      maxRetriesPerRequest: null,
    });
    this.client = client;

    let connected = false;
    let failing = false;
    client.on("error", (e: Error) => {
      if (failing) return;
      failing = true;
      this.logger.warn(`Redis unreachable: ${e.message} — retrying`);
    });
    client.on("ready", () => {
      if (connected && failing) this.logger.log("Redis reconnected");
      failing = false;
    });
    if (client.status !== "ready")
      await new Promise<void>((resolve) =>
        client.once("ready", () => resolve()),
      );
    connected = true;
    this.logger.log("Redis queue connected");

    for (const consumer of this.consumers.values()) this.start(consumer);
  }

  /** Hands a message to the queue, and says whether it got there */
  async publish(
    queue: string,
    message: unknown,
    options: PublishOptions = {},
  ): Promise<boolean> {
    if (!this.client || this.client.status !== "ready") return false;
    try {
      // BullMQ runs a job with no priority before every prioritized one, and a
      // lower number before a higher. So an urgent job carries none and an
      // ordinary one carries 1: the urgent go first, the rest keep their order.
      const priority = (options.priority ?? 0) > 0 ? 0 : 1;
      await this.queue(queue).add("m", message, { priority });
      return true;
    } catch (e) {
      this.logger.warn(
        `Publish to ${queue} failed: ${e instanceof Error ? e.message : e}`,
      );
      return false;
    }
  }

  /** How many messages are waiting across these queues, not counting any being worked on */
  async messageCount(queues: string[]): Promise<number> {
    if (!this.client || this.client.status !== "ready") return 0;
    let total = 0;
    for (const queue of queues) {
      try {
        const counts = await this.queue(queue).getJobCounts(
          "wait",
          "prioritized",
          "delayed",
        );
        total +=
          (counts.wait ?? 0) +
          (counts.prioritized ?? 0) +
          (counts.delayed ?? 0);
      } catch {
        // a queue we cannot count contributes nothing, and must not abort the count for the others
      }
    }
    return total;
  }

  /** `prefetch` is how many of this queue's messages this process works on at once */
  consume<T>(
    queue: string,
    handler: (message: T) => Promise<void>,
    prefetch: number,
  ): void {
    const consumer: Consumer = {
      queue,
      handler: handler as (message: unknown) => Promise<void>,
      prefetch: Math.max(1, prefetch),
      worker: null,
      working: 0,
    };
    this.consumers.set(queue, consumer);
    if (this.client) this.start(consumer);
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    // Let what is already running finish; past the drain, let go of the jobs —
    // their locks run out and another worker takes them
    await Promise.all(
      [...this.consumers.values()].map((consumer) => this.stop(consumer)),
    );
    await Promise.all(
      [...this.queues.values()].map((queue) => queue.close().catch(() => {})),
    );
    const client = this.client;
    this.client = null;
    if (client) await client.quit().catch(() => client.disconnect());
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.client as Redis,
        prefix: PREFIX,
        defaultJobOptions: this.jobOptions(name),
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private jobOptions(queue: string): DefaultJobOptions {
    const options: DefaultJobOptions = {
      removeOnComplete: true,
      removeOnFail: { count: KEEP_FAILED },
    };
    if (retried(queue)) {
      options.attempts = RETRIES;
      options.backoff = {
        type: "exponential",
        delay: this.options.retryDelayMs ?? RETRY_DELAY_MS,
      };
    }
    return options;
  }

  private start(consumer: Consumer): void {
    if (consumer.worker || this.closing || !this.client) return;
    const worker = new Worker(
      consumer.queue,
      async (job) => {
        consumer.working++;
        try {
          await consumer.handler(job.data);
        } finally {
          consumer.working--;
        }
      },
      {
        connection: this.client,
        prefix: PREFIX,
        concurrency: consumer.prefetch,
        ...(this.options.lockDurationMs
          ? { lockDuration: this.options.lockDurationMs }
          : {}),
        ...(this.options.stalledIntervalMs
          ? { stalledInterval: this.options.stalledIntervalMs }
          : {}),
      },
    );
    worker.on("failed", (job, e) => {
      const left = job ? job.opts.attempts! - job.attemptsMade : 0;
      this.logger.warn(
        `Message from ${consumer.queue} failed: ${e.message}${left > 0 ? ` (${left} more tries)` : ""}`,
      );
    });
    worker.on("error", (e) =>
      this.logger.warn(`Consuming ${consumer.queue}: ${e.message}`),
    );
    consumer.worker = worker;
    this.logger.log(
      `Consuming ${consumer.queue} (prefetch ${consumer.prefetch})`,
    );
  }

  /**
   * Waits out the drain for the handlers still running, then closes: gently if
   * they finished, forcibly if not. One call to close, because a second one
   * only returns the first — a forced close after a gentle one would wait on
   * the gentle one forever.
   */
  private async stop(consumer: Consumer): Promise<void> {
    const worker = consumer.worker;
    consumer.worker = null;
    if (!worker) return;
    const deadline = Date.now() + (this.options.drainMs ?? DRAIN_MS);
    while (consumer.working > 0 && Date.now() < deadline) await sleep(50);
    await worker.close(consumer.working > 0);
  }
}
