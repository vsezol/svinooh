import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { Redis } from 'ioredis';
import { QueueService, type QueueOptions } from '../src/queue/queue.service';

/**
 * The promises QueueService makes, held against a real Redis: a message reaches
 * one consumer, a consumer never works on more at once than its prefetch, an
 * urgent message jumps the queue, a message is acknowledged after its handler
 * whether the handler succeeded or not, and one that a stopped consumer never
 * acknowledged is delivered again.
 *
 * Runs when QUEUE_TEST_REDIS_URL is set and is skipped otherwise:
 *
 *   docker compose up -d redis
 *   QUEUE_TEST_REDIS_URL=redis://localhost:6379/15 npm test -w @svinooh/common
 */

const REDIS_URL = process.env.QUEUE_TEST_REDIS_URL ?? '';
const skip = !REDIS_URL && 'QUEUE_TEST_REDIS_URL is not set';

const created: string[] = [];
const opened: QueueService[] = [];

/** A queue nothing else uses. The scan queues are the ones with priorities, so `priorities` names one of those. */
function freshQueue(priorities = false): string {
  const name = `${priorities ? 'scan.' : 'test.'}t${randomBytes(4).toString('hex')}`;
  created.push(name);
  return name;
}

async function open(options: QueueOptions = {}): Promise<QueueService> {
  const queue = new QueueService(REDIS_URL, options);
  opened.push(queue);
  // A Redis that is not there is retried forever; the test should fail instead
  let timer: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`could not connect to ${REDIS_URL}`)), 20_000);
  });
  try {
    await Promise.race([queue.onApplicationBootstrap(), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
  return queue;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the queue');
    await pause(20);
  }
}

after(async () => {
  for (const queue of opened) await queue.onModuleDestroy();
  if (!REDIS_URL) return;
  const redis = new Redis(REDIS_URL);
  for (const name of created) {
    const keys = await redis.keys(`queue:${name}*`);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
});

describe('the queue', { skip }, () => {
  test('delivers what was published, once and in order', async () => {
    const name = freshQueue();
    const queue = await open();
    const seen: number[] = [];
    queue.consume<{ n: number }>(name, async (message) => void seen.push(message.n), 1);
    for (const n of [1, 2, 3]) assert.equal(await queue.publish(name, { n }), true);
    await until(() => seen.length === 3);
    await pause(300);
    assert.deepEqual(seen, [1, 2, 3]);
    await until(async () => (await queue.messageCount([name])) === 0);
  });

  test('never works on more at once than its prefetch', async () => {
    const name = freshQueue();
    const queue = await open();
    let running = 0;
    let most = 0;
    let done = 0;
    queue.consume(
      name,
      async () => {
        running++;
        most = Math.max(most, running);
        await pause(40);
        running--;
        done++;
      },
      2,
    );
    for (let n = 0; n < 8; n++) await queue.publish(name, { n });
    await until(() => done === 8);
    assert.equal(most, 2);
  });

  test('an urgent job jumps the queue', async () => {
    const name = freshQueue(true);
    const queue = await open();
    for (const n of [1, 2, 3]) await queue.publish(name, { n, urgent: false });
    await queue.publish(name, { n: 4, urgent: true }, { priority: 1 });
    await until(async () => (await queue.messageCount([name])) === 4);
    const seen: boolean[] = [];
    queue.consume<{ urgent: boolean }>(name, async (message) => void seen.push(message.urgent), 1);
    await until(() => seen.length === 4);
    assert.equal(seen[0], true);
  });

  test('the result queue takes no priority, whatever a publisher asks', async () => {
    const queue = await open();
    assert.equal(await queue.publish('scan.result', { n: 1 }, { priority: 1 }), true);
    const redis = new Redis(REDIS_URL);
    try {
      assert.equal(await redis.exists('queue:scan.result:p1'), 0);
      await redis.xtrim('queue:scan.result', 'MAXLEN', 0);
    } finally {
      await redis.quit();
    }
  });

  test('counts what is waiting, not what is being worked on', async () => {
    const name = freshQueue();
    const queue = await open();
    for (const n of [1, 2, 3]) await queue.publish(name, { n });
    await until(async () => (await queue.messageCount([name])) === 3);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    queue.consume(
      name,
      async () => {
        started++;
        await gate;
      },
      1,
    );
    await until(() => started === 1);
    await until(async () => (await queue.messageCount([name])) === 2);
    release();
    await until(async () => (await queue.messageCount([name])) === 0);
  });

  test('a handler that fails still acknowledges: the message does not come back', async () => {
    const name = freshQueue();
    const queue = await open();
    let calls = 0;
    queue.consume(
      name,
      async () => {
        calls++;
        throw new Error('the source is down');
      },
      1,
    );
    await queue.publish(name, { n: 1 });
    await until(() => calls === 1);
    await pause(500);
    assert.equal(calls, 1);
    assert.equal(await queue.messageCount([name]), 0);
  });

  test('publish says false without a connection, rather than throwing', async () => {
    const queue = new QueueService(REDIS_URL); // never started
    assert.equal(await queue.publish(freshQueue(), { n: 1 }), false);
    assert.equal(new QueueService(null).enabled, false);
  });

  test('what a stopped consumer never acknowledged is delivered again', async () => {
    const name = freshQueue();
    const key = `queue:${name}`;
    const redis = new Redis(REDIS_URL);
    await redis.call('XGROUP', 'CREATE', key, 'workers', '0', 'MKSTREAM');
    await redis.xadd(key, '*', 'm', JSON.stringify({ n: 1 }));
    // Delivered to a consumer that then went away without acknowledging it
    await redis.call('XREADGROUP', 'GROUP', 'workers', 'gone', 'COUNT', 1, 'STREAMS', key, '>');
    await redis.quit();

    const queue = await open({ abandonedAfterMs: 200, reclaimEveryMs: 100 });
    const seen: unknown[] = [];
    queue.consume(name, async (message) => void seen.push(message), 1);
    await until(() => seen.length === 1);
    assert.deepEqual(seen, [{ n: 1 }]);
    await until(async () => (await queue.messageCount([name])) === 0);
  });

  test('a slow job is not taken over from a consumer still working on it', async () => {
    const name = freshQueue();
    const options = { abandonedAfterMs: 300, reclaimEveryMs: 50 };
    const first = await open(options);
    let calls = 0;
    const slow = async () => {
      calls++;
      await pause(1_200);
    };
    first.consume(name, slow, 1);
    await first.publish(name, { n: 1 });
    await until(() => calls === 1);
    const second = await open(options);
    second.consume(name, slow, 1);
    await pause(1_500);
    assert.equal(calls, 1);
  });
});
