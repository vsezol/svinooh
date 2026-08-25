import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma.service';
import { RabbitService } from '../queue/rabbit.service';

/**
 * Бизнес-гейджи, которые считаются на момент скрейпа (async collect):
 * сколько кошельков по статусам, сколько портфелей, глубина очереди сканов.
 * Живут здесь, потому что нужны Prisma и Rabbit — MetricsService держать
 * без зависимостей.
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
          /* БД недоступна на момент скрейпа — пропускаем */
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
