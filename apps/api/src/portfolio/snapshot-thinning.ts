import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { HistoryRange } from '@svinooh/shared';
import { option } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { GRID_STEP_MS, RANGES } from './portfolio.service';

const RANGES_NARROW_TO_WIDE: HistoryRange[] = ['1h', '24h', '7d', '30d', 'all'];

export const TIERS = RANGES_NARROW_TO_WIDE.slice(1).map((range, i) => ({
  olderThanMs: RANGES[RANGES_NARROW_TO_WIDE[i]].windowMs!,
  stepMs: GRID_STEP_MS[range],
}));

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
          WITH readings AS (
            SELECT "id", "key", "createdAt",
                   date_bin(${`${tier.stepMs / 1000} seconds`}::interval, "createdAt", TIMESTAMP '2020-01-01') AS slot
            FROM "PositionSnapshot"
            WHERE "chain" = ${chain} AND "address" = ${address} AND "createdAt" < ${before}
              ${after ? Prisma.sql`AND "createdAt" >= ${after}` : Prisma.empty}
          ),
          last_in_slot AS (
            SELECT DISTINCT ON ("key", slot) "id"
            FROM readings
            ORDER BY "key", slot, "createdAt" DESC
          )
          DELETE FROM "PositionSnapshot"
          WHERE "id" IN (SELECT "id" FROM readings)
            AND "id" NOT IN (SELECT "id" FROM last_in_slot)
        `;
      }
      if (deleted) this.logger.log(`${chain}:${address} ${deleted} reading(s) thinned`);
      total += deleted;
    }
    return total;
  }
}
