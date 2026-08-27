import { Body, Controller, Post } from '@nestjs/common';
import { RabbitService, scanQueueName, type ScanJob } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { Chain } from '@svinooh/shared';
import { ScanConsumerService } from './sync/scan-consumer.service';
import { ScanResultConsumerService } from './sync/scan-result-consumer.service';

/**
 * Internal endpoint the api gateway calls when a wallet is just added, so it
 * gets scanned now instead of waiting for the next queue cycle.
 * Fire-and-forget: the call returns at once and the scan happens behind it.
 */
@Controller('internal')
export class InternalScanController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
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
    if (this.rabbit.enabled) {
      await this.rabbit.publish(scanQueueName(job.chain), job);
      return;
    }
    // No broker (local development): do it here. EVM has nowhere to go without
    // one, so it waits for a broker rather than pretending to have been scanned.
    if (job.chain === 'EVM') return;
    await this.writer.apply(await this.scanner.scanInProcess(job));
  }
}
