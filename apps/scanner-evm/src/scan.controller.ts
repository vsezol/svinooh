import { Body, Controller, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import type { ScanResult } from '@svinooh/shared';
import { config } from './config';
import { scanEvm } from './scanners/evm';

interface ScanRequest {
  address?: string;
}

/**
 * The whole public surface of this service: an address in, what it holds out.
 *
 * It answers synchronously and it can take a minute, which is fine — this is a
 * private call inside the cluster from the one service that knows what to do
 * with the answer. Keeping it a plain request/response is the point: every
 * decision about what to believe, what to write and when lives in the wallet
 * service, exactly as it did when the scanner was a function call.
 */
@Controller('internal')
export class ScanController {
  private readonly logger = new Logger(ScanController.name);

  @Post('scan')
  async scan(
    @Body() body: ScanRequest,
    @Headers('x-internal-token') token?: string,
  ): Promise<ScanResult> {
    // Reachable only on the private network, but a shared secret costs nothing
    // and means a misrouted public domain isn't a free scanning service
    if (config.internalToken && token !== config.internalToken) {
      throw new UnauthorizedException();
    }
    const address = String(body?.address || '').trim();
    if (!address) throw new UnauthorizedException('address required');

    const started = Date.now();
    const result = await scanEvm(address);
    this.logger.log(
      `${address}: $${result.totalUsd.toFixed(2)}, ${result.positions.length} positions (${Date.now() - started}ms)`,
    );
    return result;
  }
}
