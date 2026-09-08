import type { Chain, FlowDto, FlowLegDto } from '@svinooh/shared';
import type { Flow } from './performance';

/**
 * Which transfers crossed the portfolio's edge, and which only looked like it.
 *
 * A transfer is a fact about an address; a FLOW is a verdict about a portfolio,
 * and the same transfer answers differently for two of them. Moving $10k from
 * your Ledger to your hot wallet is internal if the portfolio holds both and a
 * withdrawal-and-deposit pair if it holds one — so this is decided here, on
 * read, against the set of addresses in front of us, and never stored.
 */

/** One transfer as the database holds it, which is all this needs to see */
export interface StoredTransfer {
  chain: string;
  address: string;
  txHash: string;
  minedAt: Date;
  direction: string;
  counterparty: string | null;
  network: string | null;
  operation: string;
  symbol: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

/**
 * The only two operations that are treated as money crossing the edge.
 *
 * Everything else a source can report is deliberately excluded, and the list is
 * a whitelist rather than a blacklist because the cost of the two mistakes is
 * not the same. Missing a real withdrawal leaves the chart where it is today —
 * which is what it has always shown. Inventing one subtracts money from a
 * portfolio that never lost it, and the reader has no way to tell.
 *
 * What is excluded, and why it is not a flow:
 *
 *  - `trade` — a swap. Value changed form and stayed put; both legs are inside.
 *  - `deposit` / `withdraw` — into and out of a DeFi protocol. The balance
 *    scanners already count the resulting position, so netting these off would
 *    subtract money that is still in the portfolio and plainly visible on the
 *    page. (The exception is a venue our scanners cannot see: there a deposit
 *    genuinely does look like value leaving, and this rule keeps it looking
 *    that way rather than guessing. It is in the tooltip.)
 *  - `claim`, `mint` — rewards and airdrops. Value that appeared from outside,
 *    but not capital the owner put in: it is a gain, and calling it a deposit
 *    would net a real gain away to zero.
 *  - `approve`, `revoke`, `revoke_delegation`, `delegate`, `deploy`, `bid`,
 *    `burn`, `execute` — nothing crosses, or nothing that can be told apart
 *    from a contract call that does not.
 */
const CROSSES: Record<string, 'in' | 'out'> = { receive: 'in', send: 'out' };

/** How close two sides of a self-move have to be in value to be one move */
const SELF_MOVE_TOLERANCE = 0.05;
const SELF_MOVE_FLOOR_USD = 1;

/** A flow before the self-move pass has had a chance to cancel it */
interface Candidate extends FlowDto {
  at: number;
}

const keyOf = (chain: string, address: string): string => `${chain}:${address.toLowerCase()}`;

/**
 * Groups one transaction's legs into a single flow.
 *
 * A transaction can move two assets in one direction — a contract paying out in
 * two tokens — and those are one movement of money, not two. Grouped by
 * (address, hash, direction), so the in and out sides of the same hash stay
 * apart: they are genuinely two things when they happen, and netting them here
 * would hide a swap that this classifier has already decided not to net.
 */
export function classify(
  transfers: StoredTransfer[],
  perimeter: {
    /** Every address the portfolio holds, as `chain:address` lowercased */
    addresses: Set<string>;
    /** Which of the portfolio's wallets an address belongs to */
    walletOf: Map<string, string>;
  },
  bridgeWindowMs: number,
): FlowDto[] {
  const groups = new Map<string, Candidate>();

  for (const t of transfers) {
    const direction = CROSSES[t.operation];
    if (!direction) continue;
    // The stored direction is the address's own; an operation the source called
    // `send` on a row marked `in` is a row we do not understand, and guessing
    // is how a deposit becomes a withdrawal
    if (t.direction !== direction) continue;

    // The other side is one of ours: the money never left the portfolio.
    // Compared case-insensitively because the perimeter holds base58 chains as
    // typed and EVM lowercased, and a counterparty arrives however its source
    // spells it.
    if (t.counterparty && perimeter.addresses.has(keyOf(t.chain, t.counterparty))) continue;

    const key = `${t.chain}:${t.address}:${t.txHash}:${direction}`;
    const leg: FlowLegDto = {
      symbol: t.symbol,
      amount: t.amount,
      priceUsd: t.priceUsd,
      usd: t.valueUsd,
    };

    const existing = groups.get(key);
    if (existing) {
      existing.legs.push(leg);
      // One unpriced leg makes the whole flow unpriced. Adding what we can
      // price and calling that the total would net a $50k move off a chart as
      // if it were $900 — the one direction this must never fail in.
      existing.usd = existing.usd === null || leg.usd === null ? null : existing.usd + leg.usd;
      continue;
    }

    groups.set(key, {
      at: t.minedAt.getTime(),
      t: t.minedAt.toISOString(),
      direction,
      usd: leg.usd,
      legs: [leg],
      chain: t.chain as Chain,
      network: t.network,
      txHash: t.txHash,
      counterparty: t.counterparty,
      walletId: perimeter.walletOf.get(keyOf(t.chain, t.address)) ?? null,
    });
  }

  const candidates = [...groups.values()].sort((a, b) => a.at - b.at);
  return cancelSelfMoves(candidates, bridgeWindowMs).map(({ at: _at, ...flow }) => flow);
}

/**
 * Drops the pairs that are one move rather than two.
 *
 * Bridging between your own chains, or moving through a venue that does not
 * name the other side, looks like this: money leaves one of your addresses and
 * an almost identical amount arrives at another a few minutes later, with the
 * bridge contract as the counterparty at both ends — so the perimeter test
 * above cannot see it. Left alone it reads as a withdrawal followed by a
 * deposit, and on the corrected line that is a step down and a step back up
 * across a portfolio that did not move.
 *
 * The match is on value and time, and the tolerance is real: a bridge takes a
 * fee, and the two sides are priced at different minutes. Anything outside the
 * window, or off by more than the tolerance, stays as it was — this only ever
 * removes a pair, so a missed one costs the accuracy we had before it existed.
 */
function cancelSelfMoves(flows: Candidate[], windowMs: number): Candidate[] {
  if (windowMs <= 0) return flows;
  const cancelled = new Set<number>();

  for (let i = 0; i < flows.length; i++) {
    const out = flows[i];
    if (out.direction !== 'out' || out.usd === null || cancelled.has(i)) continue;

    for (let j = i + 1; j < flows.length; j++) {
      const back = flows[j];
      if (back.at - out.at > windowMs) break; // sorted by time — nothing later can match
      if (back.direction !== 'in' || back.usd === null || cancelled.has(j)) continue;
      // The same transaction's two sides are a swap, which is somebody else's
      // rule; this one is about two transactions
      if (back.txHash === out.txHash) continue;

      const gap = Math.abs(back.usd - out.usd);
      if (gap > Math.max(out.usd * SELF_MOVE_TOLERANCE, SELF_MOVE_FLOOR_USD)) continue;
      cancelled.add(i);
      cancelled.add(j);
      break;
    }
  }

  return flows.filter((_flow, i) => !cancelled.has(i));
}

/** What the strategies measure against: a time and a signed amount */
export function toSignedFlows(flows: FlowDto[]): Flow[] {
  return flows
    .filter((f): f is FlowDto & { usd: number } => f.usd !== null)
    .map((f) => ({ t: Date.parse(f.t), usd: f.direction === 'in' ? f.usd : -f.usd }));
}
