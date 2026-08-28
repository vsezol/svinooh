import { Body, Controller, Post } from '@nestjs/common';
import { RabbitService, scanQueueName, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { Chain } from '@svinooh/shared';
import { ScanConsumerService } from './sync/scan-consumer.service';
import { ScanResultConsumerService } from './sync/scan-result-consumer.service';
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
    private readonly scanner: ScanConsumerService,
    private readonly writer: ScanResultConsumerService,
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
    };
    // Somebody is already scanning this address — the wallet gets that result,
    // which is the one it was going to wait for anyway
    if (!(await this.sync.claimForScan(job.chain, job.address))) return;
    if (this.rabbit.enabled) {
      // Nothing was queued, so nothing will release the claim — see the same
      // handling in ScanProducerService.topUp
      if (!(await this.rabbit.publish(scanQueueName(job.chain), job))) {
        await this.sync.releaseScan(job.chain, job.address);
      }
      return;
    }
    // No broker (local development): do it here. EVM has nowhere to go without
    // one, so it waits for a broker rather than pretending to have been scanned —
    // and its claim goes back, or nothing would touch that address until the
    // claim aged out.
    if (job.chain === 'EVM') {
      await this.sync.releaseScan(job.chain, job.address);
      return;
    }
    await this.writer.apply(await this.scanner.scanInProcess(job));
  }
}
