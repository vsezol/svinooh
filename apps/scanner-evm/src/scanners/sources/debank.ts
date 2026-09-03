import { Logger } from '@nestjs/common';
import { ScanHold } from '@svinooh/common';
import type { ScanResult } from '@svinooh/shared';
import { scanEvmBrowser } from '../evm-browser';
import type { EvmSource } from './source';

const logger = new Logger('DebankSource');

/**
 * EVM balances from the rendered debank.com page (headless browser,
 * evm-browser.ts) — exactly the page any anonymous visitor sees. No signature is
 * forged; all the code runs on debank.com's side. Slow (20–40s), but it survives
 * changes to their API.
 *
 * There used to be a fast signed HTTP call to api.debank.com in front of this.
 * From a datacenter IP it returned a persistent 429 — every scan fell through to
 * the browser anyway — so it was removed rather than kept as a path that only
 * ever cost ~2s per scan to fail and kept the banned endpoint warm.
 *
 * Circuit breaker: when DeBank throttles the IP the page stops rendering inside
 * the selector wait, and the worst thing we can do is come straight back for
 * more — that is what keeps us throttled. After a few consecutive failures we
 * stand down for a while and hold the last known values (ScanHold) instead.
 */
const ATTEMPTS = 2; // one immediate retry; the retry gets a longer budget
const BREAKER_THRESHOLD = 4;
const COOLDOWN_MS = 10 * 60_000;

let failures = 0;
let cooldownUntil = 0;

async function read(address: string): Promise<ScanResult> {
  if (Date.now() < cooldownUntil) {
    const leftMin = Math.ceil((cooldownUntil - Date.now()) / 60_000);
    throw new ScanHold(`EVM backing off after repeated DeBank timeouts, ~${leftMin} min left`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // The retry is patient. A first failure is often a heavy wallet whose page
      // simply did not finish rendering in the selector wait (DeBank answered,
      // the total element just was not there yet) — a second pass with a longer
      // navigation and selector budget usually catches it. A wallet DeBank is
      // refusing outright fails either way, and that is what the breaker is for.
      const result = await scanEvmBrowser(address, { patient: attempt > 1 });
      failures = 0;
      logger.log(`${address}: browser debank $${result.totalUsd.toFixed(2)}`);
      return result;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < ATTEMPTS) {
        logger.warn(
          `${address}: browser attempt ${attempt} failed (${message}) → retrying with a longer budget`,
        );
      }
    }
  }

  if (++failures >= BREAKER_THRESHOLD) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    failures = 0;
    logger.warn(
      `DeBank looks throttled — pausing EVM scans for ${COOLDOWN_MS / 60_000} min after ${BREAKER_THRESHOLD} failures in a row`,
    );
  }
  throw lastError;
}

export const debankSource: EvmSource = {
  id: 'debank',
  label: 'debank.com, rendered',
  read,
};
