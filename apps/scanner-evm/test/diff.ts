import { EVM_SOURCES } from '../src/scanners/sources';
import type { ScanPosition } from '@svinooh/shared';

/**
 * Where two strategies disagree about one address, position by position.
 *
 * The companion to strategies.test.ts: that one says a wallet has drifted, this
 * one says what drifted. Run it on the address the test named.
 *
 *   npm run -w @svinooh/scanner-evm diff -- 0x…
 *
 * Read the output for the SHAPE of the disagreement, which is what points at
 * the cause:
 *
 *  - one row with a value on one side and $0 on the other, and another row with
 *    the mirror image and a similar figure — the two are calling one protocol by
 *    different names (LISTA DAO / HELIO, PENDLE V2 / PENDLE). Nothing is
 *    missing; nothing needs adding.
 *  - one row with a value under `browser` and nothing anywhere under `api` —
 *    a venue the api strategy does not cover. That is a GapProvider, the way
 *    Hyperliquid is one.
 *  - many small rows differing in both directions — the two price illiquid
 *    tokens differently and neither is right. Not fixable here.
 */
const address = process.argv[2];
if (!address) {
  console.error('usage: npm run -w @svinooh/scanner-evm diff -- <address>');
  process.exit(1);
}

const key = (p: ScanPosition) => (p.symbol ?? '?').trim().toUpperCase();
const usd = (n: number) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

function roll(positions: ScanPosition[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of positions) out.set(key(p), (out.get(key(p)) ?? 0) + p.valueUsd);
  return out;
}

async function main(): Promise<void> {
  const [browser, api] = await Promise.all([
    EVM_SOURCES.browser.read(address),
    EVM_SOURCES.api.read(address),
  ]);

  const b = roll(browser.positions);
  const a = roll(api.positions);
  const rows = [...new Set([...b.keys(), ...a.keys()])]
    .map((k) => ({ k, b: b.get(k) ?? 0, a: a.get(k) ?? 0 }))
    .map((r) => ({ ...r, gap: r.a - r.b }))
    .filter((r) => Math.abs(r.gap) >= 1)
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));

  const gap = api.totalUsd - browser.totalUsd;
  console.log(`\n${address}`);
  console.log(
    `  browser ${usd(browser.totalUsd)} (${browser.positions.length} positions)` +
      `   api ${usd(api.totalUsd)} (${api.positions.length} positions)` +
      `   ${gap >= 0 ? '+' : ''}${((gap / browser.totalUsd) * 100).toFixed(2)}%`,
  );
  console.log(`\n  ${'position'.padEnd(24)} ${'browser'.padStart(14)} ${'api'.padStart(14)} ${'difference'.padStart(14)}`);
  for (const r of rows.slice(0, 20)) {
    console.log(
      `  ${r.k.slice(0, 24).padEnd(24)} ${usd(r.b).padStart(14)} ${usd(r.a).padStart(14)} ${usd(r.gap).padStart(14)}`,
    );
  }
  if (rows.length > 20) console.log(`  … and ${rows.length - 20} more rows differing by at least $1`);

  const covered = rows.slice(0, 20).reduce((s, r) => s + r.gap, 0);
  console.log(`\n  the rows above account for ${usd(covered)} of a ${usd(gap)} gap`);
  process.exit(0);
}

void main();
