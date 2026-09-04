import { strict as assert } from 'node:assert';
import { after, describe, test } from 'node:test';
import { closeBrowser } from '../src/scanners/browser';
import { EVM_SOURCES } from '../src/scanners/sources';
import { WALLETS } from './wallets';

/**
 * Do the two strategies still agree?
 *
 * Not a unit test: it reads live production addresses through a headless
 * browser and through three third-party APIs, and takes a couple of minutes.
 * It is a conformance check, run when a source is suspected of drifting rather
 * than on every commit — `npm run -w @svinooh/scanner-evm test:strategies`.
 *
 * What it is for: the two strategies are maintained against moving targets. A
 * venue Zerion did not cover starts being covered, DeBank changes its markup,
 * a provider's API changes shape — each of those shows up here as a wallet
 * whose gap moved, with a note saying what that wallet is made of. Without it
 * the first sign would be somebody's balance being wrong.
 *
 * Tolerances are per wallet and were measured, not chosen. Both strategies are
 * read seconds apart while prices move, so nothing is expected to agree
 * exactly; the floor below is that drift, and anything above it is a wallet
 * whose composition the two now read differently.
 */
const PRICE_DRIFT_PCT = 1;

/** Set STRATEGY_TEST_UPDATE=1 to print the gaps instead of asserting them */
const MEASURING = process.env.STRATEGY_TEST_UPDATE === '1';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const usd = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

describe('browser and api read the same wallets', () => {
  after(async () => {
    // The browser is a long-lived child process; without this the run hangs
    await closeBrowser();
  });

  for (const wallet of WALLETS) {
    test(
      `${wallet.address} — ${wallet.note}`,
      { timeout: 240_000 },
      async () => {
        const [browser, api] = await Promise.all([
          EVM_SOURCES.browser.read(wallet.address),
          EVM_SOURCES.api.read(wallet.address),
        ]);

        assert.ok(browser.totalUsd > 0, 'the browser strategy read nothing — the check is meaningless');

        const gap = ((api.totalUsd - browser.totalUsd) / browser.totalUsd) * 100;
        const allowed = Math.max(wallet.maxGapPct, PRICE_DRIFT_PCT);

        console.log(
          `    browser ${usd(browser.totalUsd).padStart(13)} ${String(browser.positions.length).padStart(4)} поз` +
            `   api ${usd(api.totalUsd).padStart(13)} ${String(api.positions.length).padStart(4)} поз` +
            `   ${pct(gap).padStart(8)}  (допуск ${allowed}%)`,
        );

        if (MEASURING) return;
        assert.ok(
          Math.abs(gap) <= allowed,
          `the two strategies now differ by ${pct(gap)}, and this wallet is recorded as agreeing within ${allowed}%.\n` +
            `  ${wallet.note}\n` +
            `  browser ${usd(browser.totalUsd)} (${browser.positions.length} positions), api ${usd(api.totalUsd)} (${api.positions.length} positions)\n` +
            `  Either a source changed what it covers, or one of them is now wrong. Compare the positions before widening the tolerance.`,
        );
      },
    );
  }
});
