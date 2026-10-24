import { Injectable } from '@nestjs/common';
import { QueueService, SCAN_MAX_PRIORITY, scanQueueName, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { Chain } from '@svinooh/shared';
import { LandingOverlay, type WalletAfterLanding } from './sync/landing-overlay';
import { SyncService } from './sync/sync.service';

export type { WalletAfterLanding } from './sync/landing-overlay';

/**
 * "Scan this one now" — the whole of what the rest of the api may ask of the
 * scan pipeline, in the two tones it can be asked in: `now`, which yields to a
 * scan already on its way, and `recheck`, which does not because it knows
 * something that scan does not.
 *
 * It was a POST to the wallet service's /internal/scan, called with fetch and
 * a five-second timeout from two places that did not wait for the answer. The
 * call is in-process now, and just as much of a no-wait: the scan takes tens of
 * seconds and the caller is answering a request.
 *
 * "Now" is what makes this racy: the address is at its most likely to already
 * be on a queue exactly when somebody has just asked for it — the producer
 * holds every never-scanned address at the top of its due list, and two people
 * opening the same wallet is one address asked for twice. So this claims the
 * address the same way the producer does, and publishes only if it got it.
 */
/** When to read a wallet again after something landed, for the indexers to catch up. */
export const CATCHING_UP_MS = [15_000, 45_000];

@Injectable()
export class ScanRequests {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly sync: SyncService,
    private readonly overlay: LandingOverlay,
  ) {}

  /** Fire and forget: the caller has an HTTP response to return */
  now(walletId: string): void {
    void this.enqueue(walletId, false).catch(() => {});
  }

  /**
   * The chain moved under a position somebody is watching: read this address
   * whether or not the clock says it is due.
   *
   * The difference from `now` is the whole point of it. `now` asks politely —
   * an address already claimed by a scan on its way is left alone, because the
   * answer that scan brings back is the one the caller was waiting for anyway.
   * This one has news that scan does not have: the reading it is about to
   * return was taken BEFORE the price left the band, and waiting out the
   * interval for the next one is the delay this exists to remove.
   *
   * So it takes the claim rather than asking for it. Landing on top of a scan
   * already in flight costs a second read of one Solana address — the watch's
   * cooldown is what keeps that from being often — and the writer applies both
   * in turn, with the later reading winning. What it must never cost is a
   * duplicate message: that is decided further down, against what the owner was
   * last told, and two identical readings say nothing twice.
   */
  recheck(walletId: string): void {
    void this.enqueue(walletId, true).catch(() => {});
  }

  /**
   * Something done from this app just landed on chain — a deposit — and the
   * person who signed it is looking at the page, waiting to see it.
   *
   * A `recheck`, because the scan the clock has scheduled was read before the
   * money moved: `now` yields to it, and on 2026-09-21 that is what made a
   * landed deposit take four minutes to appear, the forced scan quietly
   * dropped in favour of one five minutes out. Then twice more, because a
   * reading comes through indexers that can trail the chain by seconds, and a
   * first read that beats them is a read of the old wallet.
   */
  landed(walletId: string, left: WalletAfterLanding | null = null): void {
    if (left) this.overlay.hold(walletId, left);
    this.recheck(walletId);
    for (const after of CATCHING_UP_MS) setTimeout(() => this.recheck(walletId), after).unref();
  }

  private async enqueue(walletId: string, force: boolean): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;
    const job: ScanJob = {
      chain: wallet.chain as Chain,
      address: wallet.address,
      previousTotal: wallet.lastTotalUsd,
      tronResourcesAt: wallet.tronResourcesAt?.toISOString() ?? null,
    };
    if (force) {
      await this.sync.lease([{ chain: job.chain, address: job.address }]);
    } else if (!(await this.sync.takeIfFree(job.chain, job.address))) {
      // Somebody is already scanning this address — the wallet gets that
      // result, which is the one this caller was going to wait for anyway
      return;
    }
    // Somebody is watching a spinner right now: ahead of whatever is queued
    await this.queue.publish(scanQueueName(job.chain), job, { priority: SCAN_MAX_PRIORITY });
  }
}
