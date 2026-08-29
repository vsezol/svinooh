import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { RabbitService, WALLET_STATE_QUEUE } from '@svinooh/common';
import type { WalletStateEvent } from '@svinooh/shared';
import { Collector } from './collector';
import { Slowdown } from './slowdown';
import { config } from './config';

/**
 * How often to look for portfolios that have gone quiet.
 *
 * Not urgent — the thing being announced has already been true for a day — and
 * the sweep is one indexed query, so a quarter of an hour is generous either
 * way.
 */
const SLOWDOWN_SWEEP_MS = 15 * 60_000;

/**
 * The alert collector.
 *
 * Fastify rather than Nest, and no dependency injection: this service has one
 * job, three collaborators and no HTTP surface beyond a health check, so a
 * container to wire it would cost memory and buy nothing. `RabbitService` is
 * used directly — it is a plain class whose constructor takes a URL, and its
 * reconnect loop and manual acks are worth more than the decorator it carries.
 */
async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.get('/health', async () => ({ ok: true }));

  const prisma = new PrismaClient();
  const rabbit = new RabbitService(config.rabbitUrl || null);
  const collector = new Collector(prisma, rabbit);
  const slowdown = new Slowdown(prisma, rabbit);

  await rabbit.onApplicationBootstrap();
  if (rabbit.enabled) {
    rabbit.consume<WalletStateEvent>(
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
    };
    setInterval(() => void sweep(), SLOWDOWN_SWEEP_MS).unref();
  } else {
    // Nothing to do without a broker, and saying so beats looking healthy and
    // idle while somebody wonders why no alert ever arrives
    app.log.warn('RABBITMQ_URL not set — nothing to collect');
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });

  const stop = async () => {
    await rabbit.onModuleDestroy();
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

void main();
