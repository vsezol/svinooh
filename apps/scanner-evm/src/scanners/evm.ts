import { Logger } from '@nestjs/common';
import { ScanHold } from '@svinooh/common';
import { scanEvmBrowser } from './evm-browser';
import type { ScanResult } from '@svinooh/shared';
import { enrich, NO_FACTS } from '@svinooh/common';
import { evmFacts } from './defi';

const logger = new Logger('EvmScanner');

/**
 * EVM balance from the rendered debank.com page (headless browser,
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
const BROWSER_ATTEMPTS = 2; // one immediate retry; the retry gets a longer budget
const BROWSER_BREAKER_THRESHOLD = 4;
const BROWSER_COOLDOWN_MS = 10 * 60_000;

let browserFailures = 0;
let browserCooldownUntil = 0;

async function scanDebank(address: string): Promise<ScanResult> {
  if (Date.now() < browserCooldownUntil) {
    const leftMin = Math.ceil((browserCooldownUntil - Date.now()) / 60_000);
    throw new ScanHold(`EVM backing off after repeated DeBank timeouts, ~${leftMin} min left`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= BROWSER_ATTEMPTS; attempt++) {
    try {
      // The retry is patient. A first failure is often a heavy wallet whose page
      // simply did not finish rendering in the selector wait (DeBank answered,
      // the total element just was not there yet) — a second pass with a longer
      // navigation and selector budget usually catches it. A wallet DeBank is
      // refusing outright fails either way, and that is what the breaker is for.
      const result = await scanEvmBrowser(address, { patient: attempt > 1 });
      browserFailures = 0;
      logger.log(`${address}: browser debank $${result.totalUsd.toFixed(2)}`);
      return result;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < BROWSER_ATTEMPTS) {
        logger.warn(`${address}: browser attempt ${attempt} failed (${message}) → retrying with a longer budget`);
      }
    }
  }

  if (++browserFailures >= BROWSER_BREAKER_THRESHOLD) {
    browserCooldownUntil = Date.now() + BROWSER_COOLDOWN_MS;
    browserFailures = 0;
    logger.warn(
      `DeBank looks throttled — pausing EVM scans for ${BROWSER_COOLDOWN_MS / 60_000} min after ${BROWSER_BREAKER_THRESHOLD} failures in a row`,
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
