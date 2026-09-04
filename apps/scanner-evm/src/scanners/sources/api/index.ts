import { Logger } from '@nestjs/common';
import type { ScanPosition, ScanResult } from '@svinooh/shared';
import type { EvmSource } from '../source';
import { hyperliquid } from './hyperliquid';
import type { GapProvider } from './provider';
import { scanZerion } from './zerion';

const logger = new Logger('ApiSource');

export * from './provider';

/**
 * Balances from APIs rather than from a rendered page.
 *
 * Zerion for the breadth, and one provider per venue Zerion does not know
 * about. On seven production wallets the composition agrees with the browser
 * source within about a percent everywhere except a wallet full of illiquid
 * airdrops, where the two price the dust differently and neither is right.
 *
 * Adding the next gap is adding a file to GAPS. That is the whole reason this
 * is a list and not two calls in a row.
 */
const GAPS: readonly GapProvider[] = [hyperliquid];

/**
 * Zerion's own take on a venue we are about to report ourselves.
 *
 * Today Zerion returns nothing for Hyperliquid, which is why the provider
 * exists. If that changes we would add its figure to Zerion's and report the
 * wallet as holding twice what it does — so anything Zerion attributes to a
 * venue we cover is dropped, and the venue's own answer is the one kept.
 */
function withoutOverlap(positions: ScanPosition[], name: string): ScanPosition[] {
  const needle = name.toLowerCase();
  const [ours, theirs] = [
    positions.filter((p) => (p.symbol ?? '').toLowerCase().includes(needle)),
    positions.filter((p) => !(p.symbol ?? '').toLowerCase().includes(needle)),
  ];
  if (ours.length) {
    const usd = ours.reduce((sum, p) => sum + p.valueUsd, 0);
    logger.warn(
      `zerion now reports ${name} ($${usd.toFixed(2)}) — dropping it in favour of ${name}'s own answer, and this provider may no longer be needed`,
    );
  }
  return theirs;
}

async function read(address: string): Promise<ScanResult> {
  // Together: Zerion is the slow one and a provider must never be the reason a
  // scan takes longer than it already does
  const [base, ...gaps] = await Promise.all([
    scanZerion(address),
    ...GAPS.map(async (gap) => {
      try {
        return { gap, positions: await gap.read(address) };
      } catch (error) {
        // One venue being unreachable is not a reason to lose the other
        // ninety-five percent of the wallet — but it does mean this reading is
        // short, so it is said out loud rather than absorbed
        logger.warn(`${address}: ${gap.name} unreachable (${(error as Error).message})`);
        return { gap, positions: [] as ScanPosition[] };
      }
    }),
  ]);

  let positions = base.positions;
  let totalUsd = base.totalUsd;
  const breakdown = { ...(base.breakdown ?? {}) };

  for (const { gap, positions: found } of gaps) {
    if (!found.length) continue;
    positions = withoutOverlap(positions, gap.name);
    // Zerion's total is netted by Zerion and cannot be recomputed from the
    // rows, so what a provider adds is added to it rather than summed afresh
    const usd = found.reduce((sum, p) => sum + p.valueUsd, 0);
    totalUsd += usd;
    positions = [...positions, ...found];
    for (const p of found) {
      if (p.network) breakdown[p.network] = (breakdown[p.network] ?? 0) + p.valueUsd;
    }
  }

  logger.log(`${address}: api $${totalUsd.toFixed(2)}, ${positions.length} positions`);
  return { ...base, totalUsd, positions, breakdown };
}

export const apiSource: EvmSource = {
  id: 'api',
  label: 'Zerion, plus each venue it does not cover',
  read,
};
