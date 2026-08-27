import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge } from 'prom-client';
import type { Chain } from '@svinooh/shared';
import { MetricsService, RabbitService, scanQueueName, SCAN_RESULT_QUEUE } from '@svinooh/common';
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
