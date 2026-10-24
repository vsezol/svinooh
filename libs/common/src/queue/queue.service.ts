import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { serviceName } from '../env';
import { hasPriority, SCAN_MAX_PRIORITY } from '../scan-contract';

export const QUEUE_URL = Symbol('QUEUE_URL');
export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');

/** What a caller can ask of a single publish */
export interface PublishOptions {
  /** 0 is ordinary; anything higher jumps the queue, up to its declared maximum */
  priority?: number;
}

export interface QueueOptions {
  /** See ABANDONED_AFTER_MS. Tests shorten it; the heartbeat keeps to a third of it. */
  abandonedAfterMs?: number;
  /** See RECLAIM_EVERY_MS */
  reclaimEveryMs?: number;
}

/** Queue streams live under this prefix, beside anything else sharing the instance (the agent keeps `agent:`) */
const KEY_PREFIX = 'queue:';

/** One consumer group per stream: every consumer of a queue competes for its messages */
const GROUP = 'workers';

/**
 * About how many entries a stream is trimmed to. An acknowledged message is
 * deleted, so this only bites a queue that nothing drains — and this Redis has
 * no eviction, so an unbounded stream would grow until the instance fell over.
 */
const MAX_LEN = 10_000;

/** How long a blocking read waits before looking again */
const BLOCK_MS = 5_000;

/**
 * How long a read on a queue with priorities blocks on its ordinary stream before
 * it looks at the urgent one again: the longest an urgent job can wait behind an
 * idle read.
 */
const PRIORITY_BLOCK_MS = 1_000;

/**
 * A delivered message nobody has touched for this long belonged to a consumer
 * that stopped — a deploy, a crash — and is delivered again. A live consumer
 * re-claims what it holds well inside this, however long its handler runs.
 */
const ABANDONED_AFTER_MS = 60_000;

/** How often a live consumer re-claims what it holds, at most */
const HEARTBEAT_MS = 10_000;

/** How often a consumer with room looks for abandoned messages */
const RECLAIM_EVERY_MS = 30_000;

/** A consumer idle this long and holding nothing is a process that is gone; its name leaves the group */
const FORGET_CONSUMER_AFTER_MS = 60 * 60_000;

/** How long a stopping process gives the handlers already running to finish and acknowledge */
const DRAIN_MS = 5_000;

interface Consumer {
  queue: string;
  handler: (message: unknown) => Promise<void>;
  prefetch: number;
  running: boolean;
  /** Ends the loop's wait for a free slot */
  wake: (() => void) | null;
}

interface Delivery {
  key: string;
  id: string;
  body: string | null;
}

/** An entry as Redis returns it: an id and its field/value pairs, or nothing once deleted */
type Entry = [string, string[] | null] | null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The highest priority a queue takes: the scan queues take SCAN_MAX_PRIORITY, the rest none */
const topPriority = (queue: string): number => (hasPriority(queue) ? SCAN_MAX_PRIORITY : 0);

const streamKey = (queue: string, priority: number): string =>
  priority > 0 ? `${KEY_PREFIX}${queue}:p${priority}` : `${KEY_PREFIX}${queue}`;

/** Every stream of a queue, highest priority first — the order a consumer reads them in */
function streamsOf(queue: string): string[] {
  const keys: string[] = [];
  for (let priority = topPriority(queue); priority >= 0; priority--) keys.push(streamKey(queue, priority));
  return keys;
}

function toDeliveries(key: string, entries: Entry[]): Delivery[] {
  const out: Delivery[] = [];
  for (const entry of entries) {
    if (!entry || !entry[1]) continue;
    const [id, fields] = entry;
    let body: string | null = null;
    for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === 'm') body = fields[i + 1];
    out.push({ key, id, body });
  }
  return out;
}

/**
 * The queue between services — scan jobs out, scan results back, and the things
 * somebody has to be told — on Redis Streams.
 *
 * Each queue is a stream — one per priority level for the scan queues — with a
 * single consumer group, so the consumers of a queue share its messages. A
 * message is read with XREADGROUP, handled, then acknowledged and deleted in
 * one step: always, whether its handler succeeded or not. A scan that failed is
 * re-enqueued by the next top-up with fresh information; redelivering the old
 * job would only retry the same thing against the same broken source, faster.
 * What a stream still holds is therefore what is waiting or being worked on,
 * and the group's pending count is the second of those — which is how
 * messageCount tells them apart without keeping a count of its own.
 *
 * What a broker does by itself has to be done here by hand:
 *   - prefetch: each queue has its own read loop, on its own connection (a
 *     blocking read holds the connection it runs on), and reads no more than it
 *     has room to work on;
 *   - priority: the urgent stream is read first, and the ordinary one blocks
 *     only briefly, so an urgent job never waits behind an idle read;
 *   - redelivery: a dead consumer's unacknowledged messages would stay pending
 *     under a name nobody reads any more, so a live consumer re-claims what it
 *     holds every few seconds, and anything untouched past ABANDONED_AFTER_MS
 *     is taken over.
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
  private readonly readers = new Set<Redis>();
  /** Unique per process, and per instance within one, so two never share a pending list */
  private readonly consumerName = `${serviceName()}:${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  private readonly abandonedAfterMs: number;
  private readonly heartbeatMs: number;
  private readonly reclaimEveryMs: number;
  private client: Redis | null = null;
  private closing = false;
  /** Handlers running now, across every queue — what a shutdown waits for */
  private working = 0;

  constructor(
    @Inject(QUEUE_URL) private readonly url: string | null,
    @Optional() @Inject(QUEUE_OPTIONS) options: QueueOptions = {},
  ) {
    this.abandonedAfterMs = options.abandonedAfterMs ?? ABANDONED_AFTER_MS;
    this.heartbeatMs = Math.max(10, Math.min(HEARTBEAT_MS, Math.floor(this.abandonedAfterMs / 3)));
    this.reclaimEveryMs = options.reclaimEveryMs ?? RECLAIM_EVERY_MS;
  }

  get enabled(): boolean {
    return !!this.url;
  }

  /** Resolves once connected; ioredis retries a Redis that is down until it is not */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.url) {
      this.logger.log('REDIS_URL not set — queue disabled');
      return;
    }
    if (this.client || this.closing) return;
    const client = new Redis(this.url, {
      connectionName: `${serviceName()}:queue`,
      // Railway's private network resolves over IPv6, and ioredis looks up IPv4
      // only unless told otherwise
      family: 0,
      // A command sent while the connection is down waits a few retries for it —
      // long enough for an acknowledgement to survive a blip. publish() and
      // messageCount() check the status first instead, so no caller is kept
      // waiting on a queue that is not there.
      maxRetriesPerRequest: 3,
    });
    this.client = client;

    let connected = false;
    let failing = false;
    client.on('error', (e: Error) => {
      if (failing) return;
      failing = true;
      this.logger.warn(`Redis unreachable: ${e.message} — retrying`);
    });
    client.on('ready', () => {
      if (connected && failing) this.logger.log('Redis reconnected');
      failing = false;
    });
    if (client.status !== 'ready') await new Promise<void>((resolve) => client.once('ready', () => resolve()));
    connected = true;
    this.logger.log('Redis queue connected');

    for (const consumer of this.consumers.values()) this.run(consumer);
  }

  /** Hands a message to the queue, and says whether it got there */
  async publish(queue: string, message: unknown, options: PublishOptions = {}): Promise<boolean> {
    const client = this.client;
    if (!client || client.status !== 'ready') return false;
    const priority = Math.min(Math.max(0, Math.trunc(options.priority ?? 0)), topPriority(queue));
    try {
      await client.xadd(streamKey(queue, priority), 'MAXLEN', '~', MAX_LEN, '*', 'm', JSON.stringify(message));
      return true;
    } catch (e) {
      this.logger.warn(`Publish to ${queue} failed: ${errorText(e)}`);
      return false;
    }
  }

  /** How many messages are waiting across these queues, not counting any being worked on */
  async messageCount(queues: string[]): Promise<number> {
    const client = this.client;
    if (!client || client.status !== 'ready') return 0;
    let total = 0;
    for (const queue of queues) {
      for (const key of streamsOf(queue)) {
        try {
          const [length, pending] = await Promise.all([client.xlen(key), this.pendingCount(key)]);
          total += Math.max(0, length - pending);
        } catch {
          // a stream we cannot read contributes nothing, and must not abort the count for the others
        }
      }
    }
    return total;
  }

  /** `prefetch` is how many of this queue's messages this process works on at once */
  consume<T>(queue: string, handler: (message: T) => Promise<void>, prefetch: number): void {
    const consumer: Consumer = {
      queue,
      handler: handler as (message: unknown) => Promise<void>,
      prefetch: Math.max(1, prefetch),
      running: false,
      wake: null,
    };
    this.consumers.set(queue, consumer);
    if (this.client) this.run(consumer);
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    for (const consumer of this.consumers.values()) consumer.wake?.();
    for (const reader of this.readers) reader.disconnect();
    // Let what is already running finish and acknowledge: anything left pending
    // waits abandonedAfterMs before another consumer takes it over
    const deadline = Date.now() + DRAIN_MS;
    while (this.working > 0 && Date.now() < deadline) await sleep(50);
    const client = this.client;
    this.client = null;
    if (client) await client.quit().catch(() => client.disconnect());
  }

  private run(consumer: Consumer): void {
    if (consumer.running || this.closing || !this.client) return;
    consumer.running = true;
    void this.loop(consumer).finally(() => {
      consumer.running = false;
    });
  }

  private async loop(consumer: Consumer): Promise<void> {
    const client = this.client as Redis;
    const keys = streamsOf(consumer.queue);
    const reader = client.duplicate({
      connectionName: `${serviceName()}:consume:${consumer.queue}`,
      maxRetriesPerRequest: null,
    });
    reader.on('error', () => {}); // outages are reported once, by the main connection
    this.readers.add(reader);

    /** What this consumer is working on: entry id → its stream */
    const holding = new Map<string, string>();
    const heartbeat = setInterval(() => void this.keepClaimed(holding), this.heartbeatMs);
    heartbeat.unref?.();

    const backlog: Delivery[] = [];
    let groupsReady = false;
    let lastReclaim = 0;
    this.logger.log(`Consuming ${consumer.queue} (prefetch ${consumer.prefetch})`);
    try {
      while (!this.closing) {
        try {
          if (!groupsReady) {
            await this.ensureGroups(keys);
            groupsReady = true;
          }
          while (backlog.length && holding.size < consumer.prefetch) {
            const delivery = backlog.shift() as Delivery;
            holding.set(delivery.id, delivery.key);
            this.working++;
            void this.handle(consumer, delivery).finally(() => {
              holding.delete(delivery.id);
              this.working--;
              consumer.wake?.();
            });
          }
          const room = consumer.prefetch - holding.size;
          if (room <= 0 || backlog.length) {
            await new Promise<void>((resolve) => {
              consumer.wake = resolve;
            });
            consumer.wake = null;
            continue;
          }
          if (Date.now() - lastReclaim >= this.reclaimEveryMs) {
            lastReclaim = Date.now();
            backlog.push(...(await this.reclaim(consumer.queue, keys, room, holding)));
            if (backlog.length) continue;
          }
          backlog.push(...(await this.read(reader, keys, room)));
        } catch (e) {
          if (this.closing) break;
          // A Redis that restarted without its data has lost the groups too;
          // make them again rather than read from nothing forever
          if (errorText(e).includes('NOGROUP')) groupsReady = false;
          else this.logger.warn(`Consuming ${consumer.queue}: ${errorText(e)}`);
          await sleep(1_000);
        }
      }
    } finally {
      clearInterval(heartbeat);
      this.readers.delete(reader);
      reader.disconnect();
    }
  }

  /**
   * Up to `room` new messages. Higher priorities first and without waiting, so
   * an urgent job never sits behind a blocking read on the ordinary stream.
   */
  private async read(reader: Redis, keys: string[], room: number): Promise<Delivery[]> {
    for (const key of keys.slice(0, -1)) {
      const found = await this.readGroup(reader, key, room, null);
      if (found.length) return found;
    }
    const block = Math.min(keys.length > 1 ? PRIORITY_BLOCK_MS : BLOCK_MS, this.reclaimEveryMs);
    return this.readGroup(reader, keys[keys.length - 1], room, block);
  }

  private async readGroup(reader: Redis, key: string, count: number, blockMs: number | null): Promise<Delivery[]> {
    const args: Array<string | number> = ['GROUP', GROUP, this.consumerName, 'COUNT', count];
    if (blockMs !== null) args.push('BLOCK', blockMs);
    args.push('STREAMS', key, '>');
    const reply = (await reader.call('XREADGROUP', ...args)) as Array<[string, Entry[]]> | null;
    return reply ? reply.flatMap(([stream, entries]) => toDeliveries(stream, entries)) : [];
  }

  private async handle(consumer: Consumer, delivery: Delivery): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(delivery.body ?? '');
    } catch {
      await this.ack(delivery); // garbage — drop it rather than redeliver it forever
      return;
    }
    try {
      await consumer.handler(message);
    } catch (e) {
      this.logger.warn(`Message from ${consumer.queue} failed: ${errorText(e)}`);
    } finally {
      await this.ack(delivery);
    }
  }

  private async ack(delivery: Delivery): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.multi().xack(delivery.key, GROUP, delivery.id).xdel(delivery.key, delivery.id).exec();
    } catch {
      // Connection gone for longer than a blip: the entry stays pending, and is
      // taken over once it looks abandoned — delivered again rather than lost
    }
  }

  /** Messages that consumers which stopped never acknowledged, now this one's to handle */
  private async reclaim(
    queue: string,
    keys: string[],
    room: number,
    holding: Map<string, string>,
  ): Promise<Delivery[]> {
    const client = this.client as Redis;
    const taken: Delivery[] = [];
    for (const key of keys) {
      if (taken.length < room) {
        const reply = (await client.call(
          'XAUTOCLAIM',
          key,
          GROUP,
          this.consumerName,
          this.abandonedAfterMs,
          '0-0',
          'COUNT',
          room - taken.length,
        )) as [string, Entry[], string[]?];
        for (const delivery of toDeliveries(key, reply[1] ?? [])) {
          if (!holding.has(delivery.id)) taken.push(delivery);
        }
      }
      await this.forgetStopped(key);
    }
    if (taken.length) {
      this.logger.warn(`Took over ${taken.length} message(s) on ${queue} that a stopped consumer never acknowledged`);
    }
    return taken;
  }

  /**
   * Take again, as they are, the messages this consumer is working on. It resets
   * how long they look untouched without counting another delivery, which is
   * what keeps a slow handler's message from being mistaken for abandoned.
   */
  private async keepClaimed(holding: Map<string, string>): Promise<void> {
    const client = this.client;
    if (!client || client.status !== 'ready' || holding.size === 0) return;
    const byKey = new Map<string, string[]>();
    for (const [id, key] of holding) byKey.set(key, [...(byKey.get(key) ?? []), id]);
    for (const [key, ids] of byKey) {
      try {
        await client.call('XCLAIM', key, GROUP, this.consumerName, 0, ...ids, 'JUSTID');
      } catch {
        // the next beat tries again
      }
    }
  }

  /** Every deploy leaves a consumer name behind; the ones long idle and holding nothing are dropped */
  private async forgetStopped(key: string): Promise<void> {
    const client = this.client as Redis;
    const rows = (await client.call('XINFO', 'CONSUMERS', key, GROUP)) as Array<Array<string | number>>;
    for (const row of rows) {
      const info = new Map<string, string | number>();
      for (let i = 0; i + 1 < row.length; i += 2) info.set(String(row[i]), row[i + 1]);
      const name = String(info.get('name'));
      if (name === this.consumerName) continue;
      if (Number(info.get('pending')) === 0 && Number(info.get('idle')) > FORGET_CONSUMER_AFTER_MS) {
        await client.call('XGROUP', 'DELCONSUMER', key, GROUP, name);
      }
    }
  }

  private async pendingCount(key: string): Promise<number> {
    try {
      const summary = (await (this.client as Redis).xpending(key, GROUP)) as [number | string, ...unknown[]];
      return Number(summary[0]) || 0;
    } catch {
      return 0; // no group yet: nothing has been delivered from this stream
    }
  }

  private async ensureGroups(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        // From the start of the stream, not from now: what was published before
        // anybody consumed it is still work to do
        await (this.client as Redis).call('XGROUP', 'CREATE', key, GROUP, '0', 'MKSTREAM');
      } catch (e) {
        if (!errorText(e).includes('BUSYGROUP')) throw e;
      }
    }
  }
}
