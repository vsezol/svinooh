import { Injectable } from '@nestjs/common';
import { RabbitService, SCAN_MAX_PRIORITY, scanQueueName, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { Chain } from '@svinooh/shared';
import { SyncService } from './sync/sync.service';

/**
 * "Scan this one now" — the whole of what the rest of the api may ask of the
 * scan pipeline.
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
@Injectable()
export class ScanRequests {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
    private readonly sync: SyncService,
  ) {}

  /** Fire and forget: the caller has an HTTP response to return */
  now(walletId: string): void {
    void this.enqueue(walletId).catch(() => {});
  }

  private async enqueue(walletId: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;
    const job: ScanJob = {
      chain: wallet.chain as Chain,
      address: wallet.address,
      previousTotal: wallet.lastTotalUsd,
      tronResourcesAt: wallet.tronResourcesAt?.toISOString() ?? null,
    };
    // Somebody is already scanning this address — the wallet gets that result,
    // which is the one it was going to wait for anyway
    if (!(await this.sync.takeIfFree(job.chain, job.address))) return;
    // Somebody is watching a spinner right now: ahead of whatever is queued
    await this.rabbit.publish(scanQueueName(job.chain), job, { priority: SCAN_MAX_PRIORITY });
  }
}
