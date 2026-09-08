/**
 * Does a detected deposit or withdrawal line up with the balance actually
 * moving? That is the only check of this feature that is not circular.
 *
 * The chart's corrected line is `V(t) − Σflows`, so comparing it against the
 * flows proves nothing — it is built from them. What CAN be checked is the
 * other history: AddressSnapshot has been recording what each address is worth
 * every few minutes for months, independently, from a completely different
 * source. If we say $5,000 left an address on Tuesday, the snapshots either
 * show a $5,000 step there or they do not.
 *
 * Two failures to look for, and they are different bugs:
 *
 *   flow with no step   — we invented a movement. A swap read as a transfer, a
 *                         bridge counted at both ends, an approval priced at
 *                         2²⁵⁶−1. This is the dangerous direction: it subtracts
 *                         money from a portfolio that never lost it.
 *   step with no flow   — we missed one. The classifier's whitelist is too
 *                         narrow for this chain, or the source does not report
 *                         it. Harmless by comparison: the chart is then what it
 *                         has always been.
 *
 * A step is measured from the last reading before to the first reading well
 * after, so a scan mid-transaction does not read as half a withdrawal.
 *
 * Run: npm run -w apps/wallet verify:flows -- <CHAIN> <address> [days]
 *      npm run -w apps/wallet verify:flows            (every control wallet)
 */
import type { Chain } from '@svinooh/shared';
import { PrismaClient } from '@prisma/client';
import { FLOW_SOURCES } from '../src/flows/sources';

const prisma = new PrismaClient();

/** The same addresses verify:scanners uses, so one wallet is checked both ways */
const CONTROL: Array<{ chain: Chain; address: string }> = [
  { chain: 'BTC', address: 'bc1qlggpznpwv0e5nuc5lmgdcugd64lrjkspcgkyam' },
  { chain: 'SOL', address: 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL' },
  { chain: 'TRON', address: 'TEF8gN62a3v8cH956eGe2NNfPoZQsrZfi3' },
  { chain: 'EVM', address: '0xe2dd4d99f7fc9d0acbc73f52c4dc86a2dafdb53e' },
];

/** How far either side of a flow to look for the balance moving */
const SETTLE_MIN = 20;
/** A step and a flow agree if they are within this of each other */
const TOLERANCE = 0.15;

const usd = (n: number | null): string =>
  n === null ? '        —' : `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(0).padStart(8)}`;

/**
 * What the balance did across a moment: the last reading at least SETTLE_MIN
 * before it, against the first at least SETTLE_MIN after.
 *
 * Null when either side is missing — an address whose snapshots do not cover
 * this moment cannot confirm or deny anything, and saying "no step" there would
 * report every flow older than the history as invented.
 */
async function stepAcross(chain: string, address: string, at: Date): Promise<number | null> {
  const settle = SETTLE_MIN * 60_000;
  const [before, after] = await Promise.all([
    prisma.addressSnapshot.findFirst({
      where: { chain, address, createdAt: { lte: new Date(at.getTime() - settle) } },
      orderBy: { createdAt: 'desc' },
      select: { totalUsd: true },
    }),
    prisma.addressSnapshot.findFirst({
      where: { chain, address, createdAt: { gte: new Date(at.getTime() + settle) } },
      orderBy: { createdAt: 'asc' },
      select: { totalUsd: true },
    }),
  ]);
  if (!before || !after) return null;
  return after.totalUsd - before.totalUsd;
}

async function check(chain: Chain, address: string, days: number): Promise<void> {
  const since = new Date(Date.now() - days * 86400e3);
  console.log(`\n${chain} ${address} — last ${days} days`);

  // Read live rather than from the table, so this checks the SOURCE and not
  // whatever an earlier run happened to store
  const page = await FLOW_SOURCES[chain].read(address, { until: since, cursor: null, pageSize: 100 });
  if (!page.transfers.length) {
    console.log('  no transfers');
    return;
  }

  // Only what the classifier would call a flow, one row per transaction
  const moves = new Map<string, { at: Date; usd: number | null; what: string[] }>();
  for (const t of page.transfers) {
    if (t.operation !== 'send' && t.operation !== 'receive') continue;
    const sign = t.direction === 'in' ? 1 : -1;
    const key = `${t.txHash}:${t.direction}`;
    const row = moves.get(key) ?? { at: t.minedAt, usd: 0, what: [] };
    row.usd = row.usd === null || t.valueUsd === null ? null : row.usd + sign * t.valueUsd;
    row.what.push(`${t.amount.toPrecision(4)} ${t.symbol}`);
    moves.set(key, row);
  }

  console.log(
    `  ${'WHEN'.padEnd(17)} ${'FLOW SAYS'.padStart(9)} ${'BALANCE DID'.padStart(11)}  VERDICT`,
  );
  let agreed = 0;
  let disagreed = 0;
  let unknown = 0;

  for (const [, move] of [...moves].sort((a, b) => a[1].at.getTime() - b[1].at.getTime())) {
    const step = await stepAcross(chain, address, move.at);
    let verdict: string;
    if (step === null || move.usd === null) {
      verdict = step === null ? 'no snapshots either side' : 'unpriced';
      unknown++;
    } else if (Math.abs(step - move.usd) <= Math.max(Math.abs(move.usd) * TOLERANCE, 1)) {
      verdict = 'agrees';
      agreed++;
    } else {
      // Not automatically a bug: the price moves between the two readings, and
      // a busy wallet can do something else in the same twenty minutes
      verdict = `OFF BY ${usd(step - move.usd).trim()}`;
      disagreed++;
    }
    console.log(
      `  ${move.at.toISOString().slice(0, 16).replace('T', ' ').padEnd(17)}` +
        ` ${usd(move.usd)} ${usd(step)}  ${verdict}  ${move.what.join(' + ')}`,
    );
  }

  console.log(`  ${agreed} agree, ${disagreed} disagree, ${unknown} unjudgeable`);
}

async function main(): Promise<void> {
  const [chainArg, addressArg, daysArg] = process.argv.slice(2);
  const days = Number(daysArg) || 30;

  const targets =
    chainArg && addressArg
      ? [{ chain: chainArg.toUpperCase() as Chain, address: addressArg }]
      : CONTROL;

  for (const { chain, address } of targets) {
    try {
      await check(chain, address, days);
    } catch (error) {
      console.log(`\n${chain} ${address}: ${(error as Error).message}`);
    }
  }
  await prisma.$disconnect();
}

void main();
