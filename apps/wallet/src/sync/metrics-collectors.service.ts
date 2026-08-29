import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge } from 'prom-client';
import type { Chain } from '@svinooh/shared';
import {
  MetricsService,
  RabbitService,
  scanQueueName,
  SCAN_RESULT_QUEUE,
  setting,
} from '@svinooh/common';
import { PrismaService } from '@svinooh/db';

/**
 * Business gauges computed at scrape time (async collect): how many wallets by
 * status, how many portfolios, the scan queue depth. They live here because they
 * need Prisma and Rabbit — MetricsService is kept dependency-free.
 */
const SCAN_QUEUES: string[] = [
  ...(['EVM', 'SOL', 'TRON', 'BTC'] as Chain[]).map(scanQueueName),
  SCAN_RESULT_QUEUE,
];

@Injectable()
export class MetricsCollectorsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    const registers = [this.metrics.registry];
    const prisma = this.prisma;
    const rabbit = this.rabbit;

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
          this.set(await rabbit.messageCount(SCAN_QUEUES));
        } catch {
          /* no-op */
        }
      },
    });
  }
}
