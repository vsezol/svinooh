import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge } from 'prom-client';
import type { Chain } from '@svinooh/shared';
import {
  MetricsService,
  QueueService,
  scanQueueName,
  SCAN_RESULT_QUEUE,
  setting,
} from '@svinooh/common';
import { PrismaService } from '@svinooh/db';

/**
 * Business gauges computed at scrape time (async collect): how many wallets by
 * status, how many portfolios, the scan queue depth. They live here because they
 * need Prisma and the queue — MetricsService is kept dependency-free.
 */
const SCAN_QUEUES: string[] = [
  ...(['EVM', 'SOL', 'TRON', 'BTC'] as Chain[]).map(scanQueueName),
  SCAN_RESULT_QUEUE,
];

@Injectable()
export class MetricsCollectorsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    const registers = [this.metrics.registry];
    const prisma = this.prisma;
    const queues = this.queues;

    new Gauge({
      name: 'svinooh_wallets',
      help: 'Wallets by sync status',
      labelNames: ['status'] as const,
      registers,
      async collect() {
        try {
          const rows = await prisma.wallet.groupBy({ by: ['status'], _count: { _all: true } });
          this.reset();
          for (const r of rows) this.set({ status: r.status }, r._count._all);
        } catch {
          /* DB unavailable at scrape time — skip */
        }
      },
    });

    /**
     * Active addresses and forgotten ones — somebody has opened a portfolio
     * holding this one recently, or nobody has. That split is the whole pacing
     * model, and this is it as a number: everything active is read six times as
     * often as everything else, so it is also what to watch if load creeps.
     */
    new Gauge({
      name: 'svinooh_wallets_tier',
      help: 'Wallets by the schedule they are on: active (somebody is looking) or stale',
      labelNames: ['tier'] as const,
      registers,
      async collect() {
        try {
          // Two counts, done by Postgres. The obvious version — read every
          // wallet with its portfolios and tally in JS — is the same mistake
          // the scan producer used to make, except on a timer: Prometheus
          // scrapes this every minute forever.
          const activeSince = new Date(Date.now() - setting('sync.staleAfterMin') * 60_000);
          const [total, active] = await Promise.all([
            prisma.wallet.count(),
            prisma.wallet.count({
              where: {
                memberships: { some: { portfolio: { lastViewedAt: { gte: activeSince } } } },
              },
            }),
          ]);
          this.reset();
          this.set({ tier: 'active' }, active);
          this.set({ tier: 'stale' }, total - active);
        } catch {
          /* DB unavailable at scrape time — skip */
        }
      },
    });

    /**
     * Who signed up, by the identity they signed in with. The doors are
     * disjoint by design — an X account never links to a Telegram one, and a
     * wallet signature never links to either — so the sum is the user table.
     * `dev` exists so that sum stays honest even where a development sign-in
     * once created a row; in production it reads zero.
     *
     * A wallet is a door like the other two, and it was the one this gauge did
     * not count: signing in by signing a message made a user nothing here could
     * see, so the sum quietly stopped being the user table.
     */
    new Gauge({
      name: 'svinooh_users',
      help: 'Registered users by the identity they signed in with',
      labelNames: ['provider'] as const, // telegram | x | wallet | dev
      registers,
      async collect() {
        try {
          const [telegram, x, wallet, dev] = await Promise.all([
            prisma.user.count({ where: { telegramId: { not: null } } }),
            prisma.user.count({ where: { xId: { not: null } } }),
            prisma.user.count({ where: { walletAddress: { not: null } } }),
            prisma.user.count({ where: { devKey: { not: null } } }),
          ]);
          this.reset();
          this.set({ provider: 'telegram' }, telegram);
          this.set({ provider: 'x' }, x);
          this.set({ provider: 'wallet' }, wallet);
          this.set({ provider: 'dev' }, dev);
        } catch {
          /* DB unavailable at scrape time — skip */
        }
      },
    });

    new Gauge({
      name: 'svinooh_portfolios_total',
      help: 'Portfolios total',
      registers,
      async collect() {
        try {
          this.set(await prisma.portfolio.count());
        } catch {
          /* no-op */
        }
      },
    });

    new Gauge({
      name: 'svinooh_scan_queue_depth',
      help: 'Pending scan jobs across every chain queue',
      registers,
      async collect() {
        try {
          this.set(await queues.messageCount(SCAN_QUEUES));
        } catch {
          /* no-op */
        }
      },
    });
  }
}
