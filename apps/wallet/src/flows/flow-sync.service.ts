import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Chain } from '@svinooh/shared';
import { MetricsService, option, Semaphore, setting } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { FLOW_SOURCES, type RawTransfer } from './sources';

/**
 * Reads what moved through every tracked address, so the charts can tell money
 * the owner moved from money the portfolio made.
 *
 * In this service, and not behind a queue like the balance scan, because the
 * work is different in kind: one HTTP call per address, no browser, no
 * suspicious-drop arbitration, and — the deciding one — a cursor per address
 * that has to be read and written. The scanners are stateless by design and
 * have no database to keep a cursor in; the wallet service is already the only
 * thing that writes to it.
 *
 * Two jobs share one path:
 *
 *   backfill  — an address nobody has read: page backwards until the reach or
 *               the ceiling stops it, then never again
 *   catch up  — an address already read: page backwards until it meets the
 *               history it already has, which is usually one short page
 *
 * They are the same loop with a different floor, which is why there is one of
 * them. What tells them apart is `cursor`: standing means a backfill is still
 * running, null means the address is caught up and only the newest end moves.
 */
@Injectable()
export class FlowSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FlowSyncService.name);
  /** @Interval does not wait for the previous run — this is what stops an overlap */
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (option('flows.enabled') === 'on') {
      this.logger.log(`Reading transfers every ${setting('flows.intervalMin')} min`);
    } else {
      this.logger.log('flows.enabled is off — no transfers will be read');
    }
  }

  @Interval('flow-sync', 60_000)
  async tick(): Promise<void> {
    // Read live rather than at boot: the whole point of the knob is that it can
    // be switched on without a deploy, and off again when it costs too much
    if (this.ticking || option('flows.enabled') !== 'on') return;
    this.ticking = true;
    try {
      await this.pass();
    } catch (e) {
      this.logger.warn(`tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Every address that is due, up to the batch size, read in parallel */
  private async pass(): Promise<void> {
    const due = await this.due(setting('flows.batch'));
    if (!due.length) return;

    const gate = new Semaphore(setting('flows.concurrency'));
    await Promise.all(due.map((a) => gate.run(() => this.readOne(a.chain as Chain, a.address))));
  }

  /**
   * Addresses worth reading now: every address some portfolio holds whose
   * cursor has come due, plus every one that has no cursor at all.
   *
   * A left join rather than two queries, because "has never been read" and "was
   * read a while ago" are the same question asked of the same rows — and
   * because the answer has to be ordered so a new address is not permanently
   * behind a thousand old ones.
   */
  private async due(limit: number): Promise<Array<{ chain: string; address: string }>> {
    return this.prisma.$queryRaw<Array<{ chain: string; address: string }>>`
      SELECT w."chain", w."address"
      FROM "Wallet" w
      LEFT JOIN "AddressTransferCursor" c
        ON c."chain" = w."chain" AND c."address" = w."address"
      WHERE EXISTS (SELECT 1 FROM "PortfolioWallet" pw WHERE pw."walletId" = w."id")
        AND (c."nextSyncAt" IS NULL OR c."nextSyncAt" <= now())
      ORDER BY c."nextSyncAt" ASC NULLS FIRST
      LIMIT ${limit}
    `;
  }

  /**
   * One address, one pass. Pages until it meets what we already have, runs out
   * of history, or spends its budget — then writes where it got to.
   *
   * The cursor is only moved forward on a clean pass. A page that threw leaves
   * `syncedTo` exactly where it was, so the next attempt re-reads the same
   * stretch rather than leaving a hole in the middle of the history that
   * nothing would ever come back for.
   */
  private async readOne(chain: Chain, address: string): Promise<void> {
    const source = FLOW_SOURCES[chain];
    const state = await this.prisma.addressTransferCursor.findUnique({
      where: { chain_address: { chain, address } },
    });

    // A cursor standing means a backfill that has not finished; no row at all
    // means one that has not started
    const backfilling = state === null || state.cursor !== null;
    const reach = new Date(Date.now() - setting('flows.backfillDays') * 86400e3);
    // A backfill reaches as far as the setting allows; a catch-up stops at what
    // we already have. Both are "do not ask for anything older than this".
    const floor = backfilling ? reach : (state?.syncedTo ?? null);

    const ceiling = setting('flows.backfillMax');
    let cursor = backfilling ? (state?.cursor ?? null) : null;
    let seen = 0;
    let newest: Date | null = null;
    let oldest: Date | null = null;

    try {
      for (;;) {
        const page = await source.read(address, { until: floor, cursor, pageSize: 100 });
        if (page.transfers.length) {
          await this.store(chain, address, source.name, page.transfers);
          seen += page.transfers.length;
          for (const t of page.transfers) {
            if (!newest || t.minedAt > newest) newest = t.minedAt;
            if (!oldest || t.minedAt < oldest) oldest = t.minedAt;
          }
        }
        cursor = page.next;
        if (!cursor) break;
        // A catch-up asks for one page and stops: everything past it is history
        // we already hold, and paging into it is spending requests to re-read
        // what is already stored
        if (!backfilling) break;
        if (seen >= ceiling) break;
      }

      // The backfill is finished when the source ran out of pages or the budget
      // did; either way there is nothing further back worth asking for
      const more = cursor !== null && seen < ceiling;
      await this.settle(chain, address, {
        // `syncedTo` may only move forward. A catch-up that found nothing new
        // has nothing to move it to and must not reset it to now — a transfer
        // mined a minute ago and indexed a minute from now would then never be
        // asked for again.
        syncedTo: newest,
        // Coverage reaches as far back as this pass got. A finished backfill
        // reached the floor it asked for, whether or not anything was mined
        // there: we looked at that whole stretch, and finding nothing is an
        // answer. An unfinished one has only reached its oldest transfer.
        coveredFrom: more ? oldest : (oldest && oldest < reach ? oldest : reach),
        cursor: more ? cursor : null,
        error: null,
      });
      if (seen) {
        this.logger.log(`${chain}:${address} — ${seen} transfers${backfilling ? ' (backfill)' : ''}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.errors.inc({ type: 'flow-sync' });
      // Backed off, not abandoned: a source having a bad minute must not turn
      // into us asking it again in sixty seconds, forever
      await this.settle(chain, address, {
        syncedTo: null,
        coveredFrom: null,
        cursor: state?.cursor ?? null,
        error: message.slice(0, 300),
      });
      this.logger.warn(`${chain}:${address} — ${message}`);
    }
  }

  /**
   * Writes a page. `createMany` with `skipDuplicates`, because every pass
   * deliberately overlaps the one before it — the unique key on
   * (chain, address, txHash, idx) is what makes re-reading a stretch free.
   */
  private async store(
    chain: Chain,
    address: string,
    source: string,
    transfers: RawTransfer[],
  ): Promise<void> {
    await this.prisma.addressTransfer.createMany({
      skipDuplicates: true,
      data: transfers.map((t) => ({
        chain,
        address,
        txHash: t.txHash,
        idx: t.idx,
        minedAt: t.minedAt,
        direction: t.direction,
        counterparty: t.counterparty,
        network: t.network,
        operation: t.operation,
        symbol: t.symbol,
        assetId: t.assetId,
        amount: t.amount,
        priceUsd: t.priceUsd,
        valueUsd: t.valueUsd,
        source,
      })),
    });
  }

  /** Where this address got to, and when it is worth asking again */
  private async settle(
    chain: Chain,
    address: string,
    state: { syncedTo: Date | null; coveredFrom: Date | null; cursor: string | null; error: string | null },
  ): Promise<void> {
    const existing = await this.prisma.addressTransferCursor.findUnique({
      where: { chain_address: { chain, address } },
      select: { syncedTo: true, coveredFrom: true },
    });
    // Forward only — see the note at the call site
    const syncedTo =
      state.syncedTo && (!existing?.syncedTo || state.syncedTo > existing.syncedTo)
        ? state.syncedTo
        : (existing?.syncedTo ?? null);
    // Backwards only, and never cleared: coverage that has been reached stays
    // reached, and a failed pass does not shrink what an earlier one proved
    const coveredFrom =
      state.coveredFrom && (!existing?.coveredFrom || state.coveredFrom < existing.coveredFrom)
        ? state.coveredFrom
        : (existing?.coveredFrom ?? null);

    // A backfill still in flight comes back on the next tick rather than
    // waiting out a full interval — it is not done yet, and there is no reason
    // to make somebody wait half an hour per page for their first chart
    const nextSyncAt = new Date(
      Date.now() + (state.cursor ? 60_000 : setting('flows.intervalMin') * 60_000),
    );

    const row = {
      syncedTo,
      coveredFrom,
      cursor: state.cursor,
      nextSyncAt,
      lastError: state.error,
    };
    await this.prisma.addressTransferCursor.upsert({
      where: { chain_address: { chain, address } },
      create: { chain, address, ...row },
      update: row,
    });
  }
}
