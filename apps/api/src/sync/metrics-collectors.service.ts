import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge } from 'prom-client';
import { MetricsService } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { RabbitService } from '../queue/rabbit.service';

/**
 * Business gauges computed at scrape time (async collect): how many wallets by
 * status, how many portfolios, the scan queue depth. They live here because they
 * need Prisma and Rabbit — MetricsService is kept dependency-free.
 */
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
      help: 'Pending scan jobs in the RabbitMQ queue',
      registers,
      async collect() {
        try {
          this.set(await rabbit.messageCount());
        } catch {
          /* no-op */
        }
      },
    });
  }
}
