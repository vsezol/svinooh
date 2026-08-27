import { Logger } from '@nestjs/common';
import type { ScanResult } from '@svinooh/shared';
import { config } from '../config';

const logger = new Logger('EvmRemote');

/**
 * EVM scanning lives in its own service now — see apps/scanner-evm.
 *
 * It is the only chain that needs a browser, and a browser is heavy, stateful
 * and the thing that breaks: it leaks, it hangs, it gets throttled into a
 * ten-minute backoff. Sharing a process with it meant SOL, TRON and BTC — a
 * single HTTP request each — waited on all of that and died with it on a
 * restart. So it moved out, and this is what is left here: a call.
 *
 * Deliberately a plain request/response rather than a queue. Every decision
 * about what to believe and what to write stays in this service, unchanged, so
 * the scanner can be swapped, restarted or scaled without any of that moving
 * with it.
 */
export async function scanEvmRemote(address: string): Promise<ScanResult> {
  if (!config.evmScannerUrl) {
    throw new Error('EVM_SCANNER_URL is not set — the EVM scanner service is unreachable');
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${config.evmScannerUrl}/internal/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.internalToken ? { 'x-internal-token': config.internalToken } : {}),
      },
      body: JSON.stringify({ address }),
      // Its own ceiling is EVM_TIMEOUT_MS; this one only has to outlast it, or
      // we would give up on a scan that is about to succeed and scan again
      signal: AbortSignal.timeout(config.evmScannerTimeoutMs),
    });
  } catch (error) {
    throw new Error(`EVM scanner unreachable: ${error instanceof Error ? error.message : error}`);
  }
  if (!res.ok) throw new Error(`EVM scanner returned HTTP ${res.status}`);

  const result = (await res.json()) as ScanResult;
  logger.debug?.(`${address}: $${result.totalUsd?.toFixed(2)} in ${Date.now() - started}ms`);
  return result;
}
