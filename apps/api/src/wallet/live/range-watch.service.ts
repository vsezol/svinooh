import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricsService, option, setting } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import { meteoraWatchables, type MeteoraWatchable } from '../scanners/defi/meteora';
import { ScanRequests } from '../scan-requests.service';
import { activeBinId, holds } from './lb-pair';
import { PoolFeed } from './pool-feed.service';

/** Two prices parsed from the same string, compared without trusting the last bit */
const same = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

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
  /**
   * position → in range, as last CONFIRMED: held for the whole hold, or taken
   * as the baseline. Absent means never judged — the first answer is silent.
   */
  private known = new Map<string, boolean>();
  /** pool → the bin its price was in at the latest reading, and when that reading was taken */
  private active = new Map<string, { bin: number; at: number }>();
  /** position → the timer waiting to see whether a crossing holds */
  private holding = new Map<string, NodeJS.Timeout>();
  private askedAt = new Map<string, number>();
  private queued = new Map<string, NodeJS.Timeout>();
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: PoolFeed,
    private readonly scans: ScanRequests,
    private readonly metrics: MetricsService,
  ) {
    this.feed.onAccount((pool, data) => {
      const bin = activeBinId(data);
      if (bin !== null) this.observe(pool, bin, Date.now());
    });
  }

  /** Not awaited: startup does not wait on Meteora, and the first pass is minutes early anyway */
  onApplicationBootstrap(): void {
    void this.tick();
  }

  onApplicationShutdown(): void {
    for (const timer of [...this.queued.values(), ...this.holding.values()]) clearTimeout(timer);
    this.queued.clear();
    this.holding.clear();
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
      for (const timer of this.holding.values()) clearTimeout(timer);
      this.holding.clear();
      this.feed.watch([]);
      return;
    }

    // Meteora's answer is a reading of the pool as of when we ASKED. A push
    // that lands while we wait for it is newer and must not be overwritten
    const askedAt = Date.now();
    const wallets = await this.watchableWallets();
    const found: Watched[] = [];
    const answered = new Set<string>();
    for (const wallet of wallets) {
      try {
        const positions = await this.positionsOf(wallet.address);
        found.push(...positions.map((position) => ({ ...position, ...wallet })));
        for (const position of positions) answered.add(position.positionAddress);
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

    const live = new Set<string>();
    const unjudged: Watched[] = [];
    for (const positions of watched.values()) {
      for (const position of positions) {
        live.add(position.positionAddress);
        if (!this.known.has(position.positionAddress)) unjudged.push(position);
      }
    }

    // A position we have not judged yet starts from what the last scan stored
    // about it — what this system last BELIEVED, and so what its owner was last
    // told. That is what makes a restart lose nothing: a crossing that happened
    // while the process was down, or before it first looked, is a difference
    // between that and the chain, and it goes through the hold like any other.
    // Only a position no stored row can be pinned to takes its first answer
    // silently, as it did before; the scan on the clock still covers it.
    const stored = await this.lastStored(unjudged);
    if (unjudged.length) {
      this.logger.log(
        `${stored.size} of ${unjudged.length} new position(s) start from what the last scan stored; the rest from the chain`,
      );
    }
    for (const position of unjudged) {
      const bin = this.active.get(position.poolAddress)?.bin ?? position.activeBinId;
      const now = holds(position, bin);
      const was = stored.get(position.positionAddress);
      this.known.set(position.positionAddress, was ?? now);
      if (was !== undefined && was !== now) {
        this.logger.log(
          `${position.pairLabel} ${position.positionAddress.slice(0, 6)}… is ${now ? 'in' : 'out of'} range, the last scan said ${was ? 'in' : 'out'} — changed while nobody was watching`,
        );
      }
    }
    for (const position of [...this.known.keys()]) {
      if (live.has(position)) continue;
      this.known.delete(position);
      clearTimeout(this.holding.get(position));
      this.holding.delete(position);
    }
    for (const pool of [...this.active.keys()]) if (!watched.has(pool)) this.active.delete(pool);

    const was = [...this.watched.keys()].sort().join();
    this.watched = watched;
    this.feed.watch([...watched.keys()]);
    if (was !== [...watched.keys()].sort().join()) {
      this.logger.log(
        `watching ${live.size} Meteora position(s) in ${watched.size} pool(s) across ${wallets.length} wallet(s)`,
      );
    }

    // The same answer, read as a reading of the pool. The socket is what is
    // supposed to deliver these, and when it has gone quiet — dropped without
    // a word, or a pool that simply has not traded since we reconnected — this
    // is the only other place the current bin comes from. A crossing it finds
    // goes through the hold like any other.
    for (const [pool, positions] of watched) {
      const fresh = positions.find((position) => answered.has(position.positionAddress));
      if (fresh) this.observe(pool, fresh.activeBinId, askedAt);
    }
    // A reading that did not move the pool's bin judges nobody, and a position
    // just seeded from the last scan may already disagree with the bin we have
    for (const position of unjudged) this.judge(position);
  }

  /**
   * What the last scan stored about each of these positions: in range or not.
   *
   * A stored row is recognised by its band — the scan writes Meteora's own
   * min and max price there, and those are the same numbers this position
   * carries. Only a row that is the ONE match counts: a wallet holding two
   * positions in a pool can have them folded into one row with no band, and a
   * guess about which of them it describes is worse than no answer.
   */
  private async lastStored(positions: Watched[]): Promise<Map<string, boolean>> {
    const stored = new Map<string, boolean>();
    if (!positions.length) return stored;
    const rows = await this.prisma.position.findMany({
      where: {
        walletId: { in: [...new Set(positions.map((position) => position.walletId))] },
        platform: 'meteora',
        range: { not: null },
      },
      select: { walletId: true, range: true, band: true },
    });
    for (const position of positions) {
      const matches = rows.filter((row) => {
        const band = row.band as { lower?: unknown; upper?: unknown } | null;
        return (
          row.walletId === position.walletId &&
          typeof band?.lower === 'number' &&
          typeof band?.upper === 'number' &&
          same(band.lower, position.lowerPrice) &&
          same(band.upper, position.upperPrice)
        );
      });
      if (matches.length === 1) stored.set(position.positionAddress, matches[0].range === 'in');
    }
    return stored;
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
   * Where the pool's price is, as of `at`. Most readings are not news — fees
   * accrue and reserves shift on every swap while the price stays in the same
   * bin — so the bin is the only thing compared, and a reading older than the
   * one we have is dropped rather than allowed to wind the pool back.
   */
  private observe(pool: string, bin: number, at: number): void {
    const last = this.active.get(pool);
    if (last && (at < last.at || last.bin === bin)) return;
    this.active.set(pool, { bin, at });
    for (const position of this.watched.get(pool) ?? []) this.judge(position);
  }

  /**
   * A position against the latest bin of its pool.
   *
   * A crossing is not believed the moment it is seen: it has to HOLD for
   * `live.holdSec`. A price sitting on a band's edge crosses it on every other
   * swap — on 2026-09-21 a SOL/USDC position at a 0.01% bin step went out and
   * back fourteen times in fifteen minutes — and every crossing that gets as
   * far as a scan is a message. So a crossing starts a timer, going back
   * cancels it, and only a state still true when the timer runs out is
   * confirmed and read. What that costs is the hold itself, once, on a real
   * exit; what it saves is the owner's phone.
   */
  private judge(position: Watched): void {
    const bin = this.active.get(position.poolAddress)?.bin;
    if (bin === undefined) return;
    const now = holds(position, bin);
    const confirmed = this.known.get(position.positionAddress);
    if (confirmed === undefined) {
      this.known.set(position.positionAddress, now);
      return;
    }
    const waiting = this.holding.get(position.positionAddress);
    if (now === confirmed) {
      // Back where it was before the hold ran out: nothing happened
      if (waiting) clearTimeout(waiting);
      this.holding.delete(position.positionAddress);
      return;
    }
    // Two states only, so a timer already running is waiting for this one
    if (waiting) return;
    const holdMs = setting('live.holdSec') * 1000;
    if (holdMs === 0) return this.confirm(position, now, bin);
    this.holding.set(
      position.positionAddress,
      setTimeout(() => {
        this.holding.delete(position.positionAddress);
        const latest = this.active.get(position.poolAddress)?.bin;
        if (latest !== undefined && holds(position, latest) === now) this.confirm(position, now, latest);
      }, holdMs),
    );
  }

  private confirm(position: Watched, now: boolean, bin: number): void {
    this.known.set(position.positionAddress, now);
    this.metrics.liveCrossings.inc({ platform: 'meteora', direction: now ? 'in' : 'out' });
    this.logger.log(
      `${position.pairLabel} ${position.positionAddress.slice(0, 6)}… ${now ? 'back in' : 'out of'} range: bin ${bin} against ${position.lowerBinId}..${position.upperBinId} — reading ${position.address} now`,
    );
    this.ask(position.walletId);
  }

  /**
   * "Read this wallet now", at most once per wallet per cooldown.
   *
   * The hold has already dealt with a price flickering on one boundary; this
   * is for a wallet with several positions confirming one after another. The
   * first goes at once and anything inside the cooldown is collapsed into a
   * single later read — collapsed, not dropped: the scan reads the protocol
   * when it runs, so whatever is true then is what gets said.
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
