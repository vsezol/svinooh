import { Logger } from '@nestjs/common';
import { ScanHold } from '@svinooh/common';
import { config } from '../config';
import { scanEvmBrowser } from './evm-browser';
import { scanEvmHttp } from './evm-http';
import type { ScanResult } from '@svinooh/shared';
import { enrich, NO_FACTS } from '@svinooh/common';
import { evmFacts } from './defi';

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

/**
 * The same idea for the Chrome path. When DeBank starts throttling us the page
 * stops rendering inside the selector wait, and the worst thing we can do is
 * come straight back for more — that is what keeps us throttled. After a few
 * consecutive failures we stand down for a while and hold the last known
 * values instead.
 */
const CHROME_ATTEMPTS = 2; // one immediate retry: a slow render often succeeds second time
const CHROME_BREAKER_THRESHOLD = 4;
const CHROME_COOLDOWN_MS = 10 * 60_000;

let chromeFailures = 0;
let chromeCooldownUntil = 0;

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

async function scanDebank(address: string): Promise<ScanResult> {
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

  if (Date.now() < chromeCooldownUntil) {
    const leftMin = Math.ceil((chromeCooldownUntil - Date.now()) / 60_000);
    throw new ScanHold(`EVM backing off after repeated DeBank timeouts, ~${leftMin} min left`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= CHROME_ATTEMPTS; attempt++) {
    try {
      const result = await scanEvmBrowser(address);
      chromeFailures = 0;
      logger.log(`${address}: Chrome debank $${result.totalUsd.toFixed(2)}`);
      return result;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < CHROME_ATTEMPTS) {
        logger.warn(`${address}: Chrome attempt ${attempt} failed (${message}) → retrying`);
      }
    }
  }

  if (++chromeFailures >= CHROME_BREAKER_THRESHOLD) {
    chromeCooldownUntil = Date.now() + CHROME_COOLDOWN_MS;
    chromeFailures = 0;
    logger.warn(
      `DeBank looks throttled — pausing EVM scans for ${CHROME_COOLDOWN_MS / 60_000} min after ${CHROME_BREAKER_THRESHOLD} failures in a row`,
    );
  }
  throw lastError;
}

/**
 * DeBank, plus the protocols themselves for what DeBank does not say.
 *
 * DeBank decides what the wallet holds and what it is worth. Uniswap answers
 * whether a concentrated position is inside its band from the pool's own tick,
 * where svinooh otherwise infers it from which side of the pair is left; Aave
 * answers what a loan costs, which DeBank reports nowhere. Neither adds a
 * position or changes a value.
 *
 * The facts are gathered alongside the DeBank scan rather than after it: both
 * are slow, neither waits on the other, and a wallet with no Uniswap position
 * and no Aave debt costs one call per network to find that out.
 */
export async function scanEvm(address: string): Promise<ScanResult> {
  const [result, facts] = await Promise.all([
    scanDebank(address),
    evmFacts(address).catch(() => NO_FACTS),
  ]);
  return { ...result, positions: enrich(result.positions, facts) };
}
