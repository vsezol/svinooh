/**
 * The queue between services — scan jobs out, scan results back, and the things
 * somebody has to be told — carried by one of two interchangeable drivers:
 * RabbitMQ or Redis Streams. Callers only ever see QueueService; which driver is
 * underneath is a deployment's choice (QUEUE_DRIVER), not the code's.
 *
 * Both drivers keep the same promises, and test/queue.test.ts holds them to it:
 * a message reaches one consumer, a consumer never works on more at once than
 * its prefetch, an urgent message jumps the queue, a message is acknowledged
 * after its handler whether the handler succeeded or not, and one that a
 * stopped consumer never acknowledged is delivered again.
 */

/** What a caller can ask of a single publish */
export interface PublishOptions {
  /** 0 is ordinary; anything higher jumps the queue, up to its declared maximum */
  priority?: number;
}

export type QueueDriverName = 'rabbitmq' | 'redis';

/** Which driver carries the queue, and where it is */
export interface QueueConfig {
  driver: QueueDriverName;
  url: string;
}

/** What QueueService asks of a driver */
export interface QueueDriver {
  /** Connects, and starts every consumer registered so far. Resolves once connected. */
  start(): Promise<void>;
  publish(queue: string, message: unknown, options: PublishOptions): Promise<boolean>;
  messageCount(queues: string[]): Promise<number>;
  consume(queue: string, handler: (message: unknown) => Promise<void>, prefetch: number): void;
  stop(): Promise<void>;
}

/**
 * The queue this process uses, read from its environment.
 *
 * QUEUE_DRIVER picks the driver. Unset or empty it is RabbitMQ, which is what
 * every deployment ran before Redis could carry the queue — so an environment
 * nobody has touched keeps working as it did, and clearing the variable is the
 * way back. A driver without its URL is no queue at all: the same "disabled" an
 * empty RABBITMQ_URL always meant.
 */
export function queueConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QueueConfig | null {
  const driver = (env.QUEUE_DRIVER || 'rabbitmq').trim().toLowerCase();
  if (driver === 'redis') {
    const url = (env.REDIS_URL || '').trim();
    return url ? { driver, url } : null;
  }
  if (driver === 'rabbitmq') {
    const url = (env.RABBITMQ_URL || '').trim();
    return url ? { driver, url } : null;
  }
  // Loud on purpose: a typo here would otherwise be a service that boots, looks
  // healthy and never moves a message
  throw new Error(`QUEUE_DRIVER must be "redis" or "rabbitmq", not "${env.QUEUE_DRIVER}"`);
}
