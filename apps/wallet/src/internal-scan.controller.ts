import { Body, Controller, Post } from '@nestjs/common';
import { RabbitService, SCAN_MAX_PRIORITY, scanQueueName, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { Chain } from '@svinooh/shared';
import { SyncService } from './sync/sync.service';

/**
 * Internal endpoint the api gateway calls when a wallet is just added, so it
 * gets scanned now instead of waiting for the next queue cycle.
 * Fire-and-forget: the call returns at once and the scan happens behind it.
 *
 * "Now" is what makes this racy: the address is at its most likely to already be
 * on a queue exactly when somebody has just asked for it — the producer holds
 * every never-scanned address at the top of its due list, and two people opening
 * the same wallet is one address asked for twice. So this claims the address the
 * same way the producer does, and publishes only if it got it.
 */
@Controller('internal')
export class InternalScanController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
    private readonly sync: SyncService,
  ) {}

  @Post('scan')
  scan(@Body() body: { walletId?: string }): { ok: true } {
    if (body?.walletId) void this.enqueue(body.walletId).catch(() => {});
    return { ok: true };
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
    // Somebody is already scanning this address — the wallet gets that result,
    // which is the one it was going to wait for anyway
    if (!(await this.sync.takeIfFree(job.chain, job.address))) return;
    // Somebody is watching a spinner right now: ahead of whatever is queued
    await this.rabbit.publish(scanQueueName(job.chain), job, { priority: SCAN_MAX_PRIORITY });
  }
}
