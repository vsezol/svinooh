import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { QueueService, startSettings, WALLET_STATE_QUEUE } from '@svinooh/common';
import type { WalletStateEvent } from '@svinooh/shared';
import { Collector } from './collector';
import { Renewals } from './renewals';
import { Slowdown } from './slowdown';
import { Trial } from './trial';
import { config } from './config';

/**
 * How often to look for portfolios that have gone quiet, and for subscriptions
 * that are about to end or have ended.
 *
 * Not urgent — the things being announced have already been true for a day or
 * are days away — and each sweep is one indexed query, so a quarter of an hour
 * is generous either way.
 */
const SLOWDOWN_SWEEP_MS = 15 * 60_000;

/**
 * The alert collector.
 *
 * Fastify rather than Nest, and no dependency injection: this service has one
 * job, three collaborators and no HTTP surface beyond a health check, so a
 * container to wire it would cost memory and buy nothing. `QueueService` is
 * used directly — it is a plain class whose constructor takes the queue's
 * config, and its reconnects and acks are worth more than the decorator it carries.
 */
async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.get('/health', async () => ({ ok: true }));

  const prisma = new PrismaClient();
  const queues = new QueueService(config.queue);
  const trial = new Trial(prisma);
  const collector = new Collector(prisma, queues, trial);
  const slowdown = new Slowdown(prisma, queues);
  const renewals = new Renewals(prisma, queues);

  // The trial and the sweeps pace themselves on billing knobs, and slowdown on
  // the sync ones — followed live from the table, like every other service.
  // Nothing awaits this: every knob falls back to environment and default.
  startSettings(
    () => prisma.setting.findMany({ select: { key: true, value: true } }),
    (error) => app.log.warn(`could not read settings: ${error.message}`),
  );

  await queues.onApplicationBootstrap();
  if (queues.enabled) {
    queues.consume<WalletStateEvent>(
      WALLET_STATE_QUEUE,
      (event) => collector.handle(event),
      config.prefetch,
    );
    app.log.info(`listening on ${WALLET_STATE_QUEUE}`);

    const sweep = async () => {
      try {
        const sent = await slowdown.sweep();
        if (sent) app.log.info(`told ${sent} owner(s) their portfolio had gone quiet`);
      } catch (e) {
        app.log.warn(`slowdown sweep failed: ${e instanceof Error ? e.message : e}`);
      }
      try {
        const asked = await renewals.sweep();
        if (asked) app.log.info(`asked ${asked} subscriber(s) about their renewal`);
      } catch (e) {
        app.log.warn(`renewal sweep failed: ${e instanceof Error ? e.message : e}`);
      }
    };
    setInterval(() => void sweep(), SLOWDOWN_SWEEP_MS).unref();
  } else {
    // Nothing to do without a queue, and saying so beats looking healthy and
    // idle while somebody wonders why no alert ever arrives
    app.log.warn('No queue configured (QUEUE_DRIVER with REDIS_URL or RABBITMQ_URL) — nothing to collect');
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });

  const stop = async () => {
    await queues.onModuleDestroy();
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

void main();
