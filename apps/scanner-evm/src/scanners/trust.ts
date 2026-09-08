import type { ScanPosition } from '@svinooh/shared';

/**
 * The two questions a browser scan has to answer about its own reading before
 * it hands it over: whose data is this, and does the total add up.
 *
 * Their own file, free of puppeteer, so they can be tested without a browser.
 * They are the whole of what stands between DeBank showing the wrong page and
 * somebody else's balance being written to an address — see evm-browser.ts for
 * where they are called and what fills their arguments.
 */

/**
 * The payloads were fetched for somebody else.
 *
 * `capturedFor` is read out of the URL that actually delivered the data, not
 * out of what the scan was hoping for. The page interceptor drops foreign
 * payloads while it knows which address to want, and it does not know for the
 * moment between a navigation committing and the scan telling it again — so
 * this is the check that does not depend on that timing.
 *
 * Null means nothing was captured, which is a different problem with its own
 * answer upstream, not a mismatch.
 */
export function answeredForSomebodyElse(capturedFor: string | null, address: string): boolean {
  return capturedFor !== null && capturedFor.toLowerCase() !== address.toLowerCase();
}

/**
 * The header claims more money than everything under it accounts for.
 *
 * The positions carry proof of whose they are; the total does not — it is text
 * scraped out of the page header, and a number in the DOM names no address. So
 * it is checked against the one thing in the reading that IS identified.
 *
 * Loose on purpose. DeBank drops sub-cent items from the list while keeping
 * them in its sum, and this is not an audit of its arithmetic — it is here to
 * catch a header belonging to a different wallet, which is never a few percent
 * out. On 2026-09-08 a $17 wallet was handed a $1,166,714 header: sixty-eight
 * thousandfold.
 */
export function unexplainedTotal(totalUsd: number, positions: ScanPosition[]): boolean {
  if (totalUsd <= 1_000) return false; // too small to be worth doubting
  const accounted = positions.reduce((sum, p) => sum + p.valueUsd, 0);
  return totalUsd > accounted * 3 + 1_000;
}
