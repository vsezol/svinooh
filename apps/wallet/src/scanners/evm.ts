import { Logger } from '@nestjs/common';
import { config } from '../config';
import { scanEvmBrowser } from './evm-browser';
import { scanEvmHttp } from './evm-http';
import type { ScanResult } from './types';

const logger = new Logger('EvmScanner');

/**
 * Primary path is a fast HTTP call to debank.com (reverse-engineered signature,
 * evm-http.ts). On ANY miss, transparently fall back to reading the rendered
 * page via headless Chrome (evm-browser.ts). This is by design: HTTP is cheap
 * but fragile; the browser is slow but survives changes to their API.
 *
 * Circuit breaker: if a datacenter IP catches a DeBank soft-ban (persistent
 * 429s), there's no point spending ~2s per scan on an HTTP miss AND continuing
 * to hammer the banned endpoint, extending the ban. After N consecutive misses
 * the HTTP path "opens" for a cooldown — scans go STRAIGHT to Chrome. Once the
 * cooldown expires, one probe HTTP call: on success we close it again, on a
 * miss we pause once more.
 */

const BREAKER_THRESHOLD = 3; // this many consecutive HTTP misses open the circuit
const BREAKER_COOLDOWN_MS = 30 * 60_000; // how long we disable HTTP for

let consecutiveFailures = 0;
let openedUntil = 0; // timestamp until which we skip HTTP

function httpAllowedNow(): boolean {
  if (!config.evmHttpEnabled) return false;
  if (openedUntil === 0) return true;
  if (Date.now() >= openedUntil) {
    // half-open: allow one probe attempt
    openedUntil = 0;
    return true;
  }
  return false;
}

function noteHttpSuccess(): void {
  consecutiveFailures = 0;
  openedUntil = 0;
}

function noteHttpFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD && openedUntil === 0) {
    openedUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logger.warn(
      `DeBank HTTP path opened for ${BREAKER_COOLDOWN_MS / 60_000} min after ${consecutiveFailures} consecutive misses — scans go via Chrome`,
    );
  }
}

export async function scanEvm(address: string): Promise<ScanResult> {
  if (httpAllowedNow()) {
    try {
      const result = await scanEvmHttp(address);
      noteHttpSuccess();
      logger.log(`${address}: HTTP debank $${result.totalUsd.toFixed(2)}`);
      return result;
    } catch (error) {
      noteHttpFailure();
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`${address}: HTTP path failed (${message}) → falling back to Chrome`);
    }
  }
  const result = await scanEvmBrowser(address);
  logger.log(`${address}: Chrome debank $${result.totalUsd.toFixed(2)}`);
  return result;
}
