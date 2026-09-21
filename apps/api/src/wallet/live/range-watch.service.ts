import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricsService, option, setting } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { meteoraWatchables, type MeteoraWatchable } from '../scanners/defi/meteora';
import { ScanRequests } from '../scan-requests.service';
import { activeBinId, holds } from './lb-pair';
import { PoolFeed } from './pool-feed.service';

/** One position, and whose wallet it hangs off */
interface Watched extends MeteoraWatchable {
  walletId: string;
  address: string;
}

/**
 * The chain, watched directly, so a pool leaving its range is noticed in the
 * second it happens instead of on the next scan.
 *
 * **What this does NOT do is send anything.** A crossing here is not an alert;
 * it is a reason to read the wallet NOW. The reading, what it means, who asked
 * to hear about it and whether they have already been told all stay exactly
 * where they were — in the scan pipeline and the alert collector — so there is
 * still only one thing in this system that decides to message somebody, and
 * nothing to de-duplicate between two of them. A protocol this cannot watch
 * simply keeps the pace the clock sets, and a protocol it can watch keeps the
 * same messages, sooner.
 *
 * That is also what makes it safe to be approximate. The bins are read from
 * Meteora and compared against the pool's own account; if we are wrong about a
 * boundary the cost is a scan nobody needed, not a message nobody wanted —
 * because the scan re-reads the protocol and the collector compares what it
 * finds against what the owner was last told.
 *
 * Meteora on Solana only, for now. Orca and the EVM pools have the same shape
 * of answer — an account with a tick or a bin in it — and would join here.
 */
@Injectable()
export class RangeWatch implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RangeWatch.name);
  /** pool account → the positions somebody holds in it */
  private watched = new Map<string, Watched[]>();
  /** position → in range, as far as we know. Absent means never judged: baseline, say nothing */
  private known = new Map<string, boolean>();
  /** pool → the bin its price was in when we last heard */
  private active = new Map<string, number>();
  private askedAt = new Map<string, number>();
  private queued = new Map<string, NodeJS.Timeout>();
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: PoolFeed,
    private readonly scans: ScanRequests,
    private readonly metrics: MetricsService,
  ) {
    this.feed.onAccount((pool, data) => this.moved(pool, data));
  }

  /** Not awaited: startup does not wait on Meteora, and the first pass is minutes early anyway */
  onApplicationBootstrap(): void {
    void this.tick();
  }

  onApplicationShutdown(): void {
    for (const timer of this.queued.values()) clearTimeout(timer);
    this.queued.clear();
  }

  /**
   * Who is worth listening to, and where their positions are.
   *
   * Every pass asks from scratch: positions open and close, and a subscription
   * to a pool nobody holds any more is a cost with no reader. It is also the
   * only thing that notices a NEW position, since the chain cannot tell us
   * about an account we never subscribed to.
   */
  @Interval('live-range-reconcile', setting('live.reconcileMin') * 60_000)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.warn(`could not reconcile: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async reconcile(): Promise<void> {
    if (option('live.ranges') === 'off') {
      if (this.watched.size) this.logger.log('live.ranges is off — letting go of every pool');
      this.watched = new Map();
      this.known.clear();
      this.active.clear();
      this.feed.watch([]);
      return;
    }

    const wallets = await this.watchableWallets();
    const found: Watched[] = [];
    for (const wallet of wallets) {
      try {
        const positions = await this.positionsOf(wallet.address);
        found.push(...positions.map((position) => ({ ...position, ...wallet })));
      } catch (error) {
        // Meteora said nothing, which is not the same as "no positions": keep
        // watching what this wallet had until it answers otherwise
        this.logger.warn(`meteora would not answer for ${wallet.address}: ${(error as Error).message}`);
        found.push(...this.heldBy(wallet.walletId));
      }
    }

    const watched = new Map<string, Watched[]>();
    for (const position of found) {
      const pool = watched.get(position.poolAddress);
      if (pool) pool.push(position);
      else watched.set(position.poolAddress, [position]);
    }

    // A position we have never judged takes its first answer silently — it has
    // been in whatever state it is in for an unknown while, and that is not
    // this pass's news any more than it is the first scan's
    const live = new Set<string>();
    for (const [pool, positions] of watched) {
      for (const position of positions) {
        live.add(position.positionAddress);
        if (this.known.has(position.positionAddress)) continue;
        const bin = this.active.get(pool) ?? position.activeBinId;
        this.known.set(position.positionAddress, holds(position, bin));
      }
    }
    for (const position of [...this.known.keys()]) if (!live.has(position)) this.known.delete(position);
    for (const pool of [...this.active.keys()]) if (!watched.has(pool)) this.active.delete(pool);

    const was = [...this.watched.keys()].sort().join();
    this.watched = watched;
    this.feed.watch([...watched.keys()]);
    if (was !== [...watched.keys()].sort().join()) {
      this.logger.log(
        `watching ${live.size} Meteora position(s) in ${watched.size} pool(s) across ${wallets.length} wallet(s)`,
      );
    }
  }

  /**
   * The SOL wallets holding a Meteora position that somebody would be told
   * about: an owner with a chat to reach, who has not turned range alerts off.
   *
   * Driven off the positions the last scan stored rather than off the wallets,
   * so Meteora is asked about addresses that are known to hold something of
   * its. A wallet nobody is alerted about is not watched at all — the fast
   * path exists to make a message sooner, and there is no message.
   */
  private async watchableWallets(): Promise<Array<{ walletId: string; address: string }>> {
    const rows = await this.prisma.position.findMany({
      where: {
        platform: 'meteora',
        wallet: {
          chain: 'SOL',
          memberships: {
            some: {
              OR: [{ alerts: { is: null } }, { alerts: { rangeAlerts: true } }],
              portfolio: {
                owner: {
                  user: { OR: [{ telegramId: { not: null } }, { alertChatId: { not: null } }] },
                },
              },
            },
          },
        },
      },
      select: { walletId: true, wallet: { select: { address: true } } },
      distinct: ['walletId'],
    });
    return rows.map((row) => ({ walletId: row.walletId, address: row.wallet.address }));
  }

  /**
   * What Meteora says this address holds, bins and all. A method rather than a
   * bare call so a test can hand it positions without a network — everything
   * else in here is timers and bytes, and neither is worth faking.
   */
  protected positionsOf(address: string): Promise<MeteoraWatchable[]> {
    return meteoraWatchables(address);
  }

  private heldBy(walletId: string): Watched[] {
    return [...this.watched.values()].flat().filter((position) => position.walletId === walletId);
  }

  /**
   * The pool moved. Most pushes are not news — fees accrue and reserves shift
   * on every swap while the price stays in the same bin — so the bin itself is
   * the only thing compared.
   */
  private moved(pool: string, data: Buffer): void {
    const bin = activeBinId(data);
    if (bin === null || this.active.get(pool) === bin) return;
    this.active.set(pool, bin);

    for (const position of this.watched.get(pool) ?? []) {
      const now = holds(position, bin);
      const before = this.known.get(position.positionAddress);
      if (before === now) continue;
      this.known.set(position.positionAddress, now);
      if (before === undefined) continue;
      this.metrics.liveCrossings.inc({ platform: 'meteora', direction: now ? 'in' : 'out' });
      this.logger.log(
        `${position.pairLabel} ${position.positionAddress.slice(0, 6)}… ${now ? 'back in' : 'out of'} range: bin ${bin} against ${position.lowerBinId}..${position.upperBinId} — reading ${position.address} now`,
      );
      this.ask(position.walletId);
    }
  }

  /**
   * "Read this wallet now", at most once per wallet per cooldown.
   *
   * A price sitting on a boundary crosses it repeatedly, and every crossing
   * would otherwise be a scan — so the first one goes at once and anything
   * inside the cooldown is collapsed into a single later read. Collapsed, not
   * dropped: the scan reads the protocol when it runs, so whatever is true
   * then is what gets said, and a crossing followed by a crossing back is one
   * scan that finds nothing changed and says nothing.
   */
  private ask(walletId: string): void {
    if (this.queued.has(walletId)) return;
    const last = this.askedAt.get(walletId);
    const wait =
      last === undefined ? 0 : Math.max(0, setting('live.cooldownSec') * 1000 - (Date.now() - last));
    const go = () => {
      this.queued.delete(walletId);
      this.askedAt.set(walletId, Date.now());
      this.scans.recheck(walletId);
    };
    if (wait === 0) return go();
    this.queued.set(walletId, setTimeout(go, wait));
  }
}
