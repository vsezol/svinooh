import { Body, Controller, Post } from '@nestjs/common';
import { SyncService } from './sync/sync.service';

/**
 * Internal endpoint the api gateway calls when a wallet is just added, so it
 * gets scanned immediately instead of waiting for the next queue cycle.
 * Fire-and-forget: the scan runs in the background, the call returns at once.
 */
@Controller('internal')
export class InternalScanController {
  constructor(private readonly sync: SyncService) {}

  @Post('scan')
  scan(@Body() body: { walletId?: string }): { ok: true } {
    if (body?.walletId) void this.sync.scanWalletNow(body.walletId).catch(() => {});
    return { ok: true };
  }
}
