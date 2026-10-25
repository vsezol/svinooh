import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { HistoryRange } from '@svinooh/shared';
import { option } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { GRID_STEP_MS, RANGES } from './portfolio.service';

const WIDENING: HistoryRange[] = ['1h', '24h', '7d', '30d', 'all'];

/**
 * How fine position history has to stay, by age.
 *
 * A position chart draws the last reading in each slot of its range's grid. A
 * reading older than one range's window is drawn only by the wider ranges, so
 * past that age only the last reading per slot of the next grid can ever be
 * seen. The grids divide one another and share an origin, so the reading a
 * finer tier keeps is the one every coarser grid picks too: thinning changes
 * no chart.
 */
export const TIERS = WIDENING.slice(1).map((range, i) => ({
  olderThanMs: RANGES[WIDENING[i]].windowMs!,
  stepMs: GRID_STEP_MS[range],
}));

/**
 * Every scan writes a row per position, and nothing else ever removed one: a
 * wallet with four hundred positions scanned every twenty minutes added a
 * quarter of a million rows a week, almost all of which no chart could draw.
 */
@Injectable()
export class SnapshotThinning {
  private readonly logger = new Logger(SnapshotThinning.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 3 * * *', { name: 'snapshot-thinning' })
  async nightly(): Promise<void> {
    if (option('history.thinning') !== 'on') return;
    try {
      const deleted = await this.thin(new Date());
      this.logger.log(`position history thinned: ${deleted} reading(s) deleted`);
    } catch (e) {
      this.logger.warn(`position history thinning failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** One statement per wallet and tier, so no single delete holds the whole table's worth of rows */
  async thin(now: Date): Promise<number> {
    const wallets = await this.prisma.$queryRaw<Array<{ chain: string; address: string }>>`
      SELECT DISTINCT "chain", "address" FROM "PositionSnapshot"
    `;
    let total = 0;
    for (const { chain, address } of wallets) {
      let deleted = 0;
      for (const [i, tier] of TIERS.entries()) {
        const before = new Date(now.getTime() - tier.olderThanMs);
        const next = TIERS[i + 1];
        const after = next ? new Date(now.getTime() - next.olderThanMs) : null;
        deleted += await this.prisma.$executeRaw`
          DELETE FROM "PositionSnapshot"
          WHERE "id" IN (
            SELECT "id" FROM (
              SELECT "id", row_number() OVER (
                PARTITION BY "key", date_bin(${`${tier.stepMs / 1000} seconds`}::interval, "createdAt", TIMESTAMP '2020-01-01')
                ORDER BY "createdAt" DESC
              ) AS "rank"
              FROM "PositionSnapshot"
              WHERE "chain" = ${chain} AND "address" = ${address} AND "createdAt" < ${before}
                ${after ? Prisma.sql`AND "createdAt" >= ${after}` : Prisma.empty}
            ) ranked
            WHERE "rank" > 1
          )
        `;
      }
      if (deleted) this.logger.log(`${chain}:${address} ${deleted} reading(s) thinned`);
      total += deleted;
    }
    return total;
  }
}
