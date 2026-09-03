import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Wallet } from '@prisma/client';
import type { Chain, TronResources } from '@svinooh/shared';
import { config } from '../config';
import { leaseUntil, retryAt, schedule, ScanHold, setting } from '@svinooh/common';
import { MetricsService, RabbitService, WALLET_STATE_QUEUE, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { alertableStates } from './wallet-state';
import { scanAddress } from '../scanners';
import type { ScanPosition, ScanResult } from '@svinooh/shared';

/**
 * What the wallet could collect right now, and what it owes.
 *
 * Both are read off the legs of each position rather than off the position's
 * own total: a lending position's value is already net of its debt, so the debt
 * is only visible one level down. Borrow legs arrive negative and are counted
 * as what they are — an amount owed, which is a positive number.
 *
 * The same two sums are derived in the browser for the cards on the portfolio
 * page (`web/src/lib/blocks.ts`). They are computed here as well because a
 * chart needs them at the moment of the reading, and there is no reading to go
 * back to afterwards.
 */
function accrued(positions: ScanPosition[]): { claimableUsd: number; debtUsd: number } {
  let claimableUsd = 0;
  let debtUsd = 0;
  for (const position of positions) {
    for (const token of position.tokens ?? []) {
      if (token.role === 'reward') claimableUsd += token.valueUsd;
      else if (token.role === 'borrow') debtUsd += Math.abs(token.valueUsd);
    }
  }
  return { claimableUsd, debtUsd };
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly rabbit: RabbitService,
  ) {}


  /**
   * What is due, oldest first.
   *
   * One indexed column and no arithmetic: whoever last knew something about
   * this address's timing already wrote the answer down. It used to load every
   * wallet in the database with its portfolios attached and work out the same
   * thing in JavaScript on every tick.
   */
  async dueForScan(limit: number): Promise<ScanJob[]> {
    const due = await this.prisma.wallet.findMany({
      where: { nextScanAt: { lte: new Date() } },
      orderBy: { nextScanAt: 'asc' },
      take: limit,
      select: {
        id: true,
        chain: true,
        address: true,
        lastTotalUsd: true,
        lastSyncedAt: true,
        tronResourcesAt: true,
      },
    });

    return due.map((w) => ({
      chain: w.chain as Chain,
      address: w.address,
      // previousTotal travels with the job so the scanner can re-read a
      // suspicious drop while it still has the page open
      previousTotal: w.lastTotalUsd,
      tronResourcesAt: w.tronResourcesAt?.toISOString() ?? null,
      // Somebody pasted this address and is watching a spinner
      priority: w.lastSyncedAt === null ? 'urgent' : 'normal',
    }));
  }

  /**
   * Hold these addresses for the length of a scan, so the next top-up does not
   * dispatch them again while they are still in the queue.
   *
   * Taken before publishing rather than after: the api forces a scan the moment
   * somebody adds a wallet, and that lands at exactly the same time as a tick.
   * Postgres serialises the two UPDATEs, and `count` says how many rows this
   * caller actually took.
   */
  async lease(addresses: Array<{ chain: string; address: string }>): Promise<void> {
    if (!addresses.length) return;
    const until = leaseUntil(new Date());
    await this.prisma.wallet.updateMany({
      where: { OR: addresses.map(({ chain, address }) => ({ chain, address })) },
      data: { nextScanAt: until },
    });
  }

  /** One address, taken only if nobody else holds it — the api's forced scan */
  async takeIfFree(chain: string, address: string): Promise<boolean> {
    const { count } = await this.prisma.wallet.updateMany({
      where: { chain, address, nextScanAt: { lte: new Date() } },
      data: { nextScanAt: leaseUntil(new Date()) },
    });
    return count > 0;
  }

  /**
   * When this address is next worth scanning, from who has been looking at it.
   * The one place that decides — see schedule().
   */
  private async nextScanFor(walletId: string, lastSyncedAt: Date | null): Promise<Date> {
    const holders = await this.prisma.portfolioWallet.findMany({
      where: { walletId },
      select: { portfolio: { select: { lastViewedAt: true } } },
    });
    return schedule(holders.map((h) => h.portfolio), lastSyncedAt, new Date()).nextScanAt;
  }

  async applyResult(wallet: Wallet, result: ScanResult): Promise<void> {
    const now = new Date();
    // Decided from who has been looking, before the write, so the interval and
    // the reading land in the same transaction
    const nextScanAt = await this.nextScanFor(wallet.id, now);
    await this.prisma.$transaction([
      this.prisma.position.deleteMany({ where: { walletId: wallet.id } }),
      this.prisma.position.createMany({
        data: result.positions.map((p) => ({
          walletId: wallet.id,
          symbol: p.symbol.slice(0, 120),
          name: p.name?.slice(0, 200) ?? null,
          note: p.note?.slice(0, 300) ?? null,
          network: p.network?.slice(0, 40) ?? null,
          amount: p.amount ?? null,
          priceUsd: p.priceUsd ?? null,
          valueUsd: p.valueUsd,
          platform: p.platform ?? null,
          category: p.category,
          apy: p.apy ?? null,
          healthRate: p.healthRate ?? null,
          borrowApy: p.borrowApy ?? null,
          range: p.range ?? null,
          // Prisma types JSON structurally; the band is handed over opaque
          band: p.band ? (p.band as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          // Prisma types JSON columns structurally; our leg array has to be
          // handed over as an opaque JSON value
          tokens: p.tokens?.length ? (p.tokens as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        })),
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: 'ok',
          lastTotalUsd: result.totalUsd,
          lastSyncedAt: now,
          nextScanAt,
          lastError: null,
          lowReadings: 0,
          breakdown: result.breakdown ?? {},
          unpriced: result.unpriced ?? [],
          // Only when this scan actually read them. A scan that skipped the
          // read (not due) or whose read failed leaves the stored snapshot
          // alone — replacing it with a gap would blank the page and, worse,
          // re-baseline the reclaim/delegate flags into silence.
          ...(result.tron
            ? {
                tronResources: result.tron as unknown as Prisma.InputJsonValue,
                tronResourcesAt: now,
              }
            : {}),
        },
      }),
      this.prisma.addressSnapshot.create({
        data: {
          chain: wallet.chain,
          address: wallet.address,
          totalUsd: result.totalUsd,
          ...accrued(result.positions),
          breakdown: result.breakdown ?? undefined,
        },
      }),
    ]);
    await this.announce(wallet, result);
  }

  /**
   * Says what the address looks like now, for whoever decides who should hear
   * about it.
   *
   * Published after the positions are written, not before: a reader that came
   * to look would otherwise find the previous scan's rows and answer about the
   * wrong state. It carries no owner and no settings — who watches this address
   * and what they asked for is the reader's business, and a scan should not
   * have to know. One message per address, however many portfolios hold it; the
   * collector is what fans it out to their separate thresholds.
   *
   * A failure to publish is logged and swallowed. The scan succeeded and its
   * result is stored; losing the announcement costs one cycle of alerts, and
   * failing the scan over it would cost the balance too.
   */
  private async announce(wallet: Wallet, result: ScanResult): Promise<void> {
    const positions = alertableStates(result.positions);
    // Resources this scan read, or the ones already stored — the collector is
    // judging the wallet as it stands, and a scan that did not re-read them has
    // not made them untrue. Whichever we have; null if there has never been one.
    const tron = result.tron ?? ((wallet.tronResources as TronResources | null) || null);
    // An address with neither a watchable position nor resources has nothing
    // anybody could have asked to hear about
    if (!positions.length && !tron) return;
    try {
      await this.rabbit.publish(WALLET_STATE_QUEUE, {
        walletId: wallet.id,
        address: wallet.address,
        chain: wallet.chain as Chain,
        positions,
        tron,
        // The scanners drop what they could not reach before this point, so
        // nothing here can name it yet. Carrying it is what will let a reader
        // hold a position's previous state instead of calling it gone.
        unreachable: [],
        at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`could not announce ${wallet.address}: ${(error as Error).message}`);
    }
  }

  /**
   * A reading we chose not to believe: count it and change nothing else.
   *
   * The address keeps its value, its status and the lease it is under, which is
   * the backoff this case wanted anyway — a source arguing with itself is not
   * worth re-asking immediately.
   */
  async noteLowReading(walletId: string, lowReadings: number): Promise<void> {
    await this.prisma.wallet.update({ where: { id: walletId }, data: { lowReadings } });
  }

  /**
   * We deliberately leave the last successful cached value untouched — it is
   * served with a stale flag.
   *
   * The address backs off rather than coming due immediately: a source that is
   * down would otherwise be asked about the same address on every top-up, which
   * is how somebody else's outage becomes our own rate limit.
   */
  async markFailed(wallet: Wallet, message: string): Promise<void> {
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        status: 'failed',
        lastError: message.slice(0, 500),
        nextScanAt: retryAt(new Date()),
      },
    });
  }

  /** Which portfolios hold this address, so their totals can be re-recorded */
  async portfoliosHolding(walletId: string): Promise<string[]> {
    const rows = await this.prisma.portfolioWallet.findMany({
      where: { walletId },
      select: { portfolioId: true },
    });
    return [...new Set(rows.map((r) => r.portfolioId))];
  }

  async snapshotPortfolio(portfolioId: string): Promise<void> {
    const held = await this.prisma.portfolioWallet.findMany({
      where: { portfolioId },
      select: { wallet: { select: { lastTotalUsd: true } } },
    });
    if (!held.length) {
      // the last wallet was removed — record a zero so the chart reflects it
      await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd: 0 } });
      return;
    }
    const known = held.filter((h) => h.wallet.lastTotalUsd !== null);
    if (!known.length) return; // nothing has been scanned yet
    const totalUsd = known.reduce((sum, h) => sum + (h.wallet.lastTotalUsd ?? 0), 0);
    await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd } });
  }
}
