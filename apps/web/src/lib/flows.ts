import type { ChangeDto, FlowDto, PerformanceBasis } from '@svinooh/shared';
import { fmtUsd } from './format';

/**
 * The experimental switch: whether the page offers to net deposits and
 * withdrawals off the chart.
 *
 * A constant in the code, like AGENT_ENABLED, and not an environment variable:
 * it is a decision about what is finished, and it changes in a commit somebody
 * can point at. The server has its own switch (`flows.enabled` in the settings
 * registry) for turning the ingestion off without a deploy; this one decides
 * whether the control exists at all.
 */
export const FLOWS_ENABLED = true;

/**
 * Which basis a portfolio is being read on, remembered per portfolio in this
 * browser.
 *
 * Per portfolio rather than globally, because the answer is not the same for
 * all of them: a portfolio somebody funds every month is unreadable on the raw
 * basis, and one that has never seen a transfer is identical on both. And in
 * localStorage rather than on the account, because this is an experiment — it
 * costs a migration and an endpoint to save it server-side, and neither is
 * worth spending before the feature has earned it.
 */
const KEY = 'sv.flows.basis';

const storageKey = (slug: string): string => `${KEY}:${slug}`;

export function readBasis(slug: string): PerformanceBasis {
  try {
    return window.localStorage.getItem(storageKey(slug)) === 'net-flows' ? 'net-flows' : 'raw';
  } catch {
    // Private windows and blocked site data throw on access rather than
    // answering empty. The default is the basis the page has always used.
    return 'raw';
  }
}

export function writeBasis(slug: string, basis: PerformanceBasis): void {
  try {
    window.localStorage.setItem(storageKey(slug), basis);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it
  }
}

/**
 * Whether the corrected basis has anything to offer for what is on screen.
 *
 * Not "are there flows": a portfolio with none is legitimately identical on
 * both bases, and the toggle should still say so. What makes the control
 * pointless is having no coverage at all — nothing was read, so there is
 * nothing to correct by and the switch would silently do nothing.
 */
export const hasFlowData = (flowsFrom: string | null): boolean => flowsFrom !== null;

/** "+$432 (+0.51%)", or just the money where there is no honest rate to quote */
export function changeLabel(change: ChangeDto): string {
  const up = change.usd >= 0;
  const money = (up ? '+' : '−') + fmtUsd(Math.abs(change.usd), 0);
  if (change.pct === null) return money;
  return `${money} (${up ? '+' : ''}${change.pct.toFixed(2)}%)`;
}

/** The amounts on a flow row: "1.5 WETH", "5,000 USDC" */
export function legLabel(leg: FlowDto['legs'][number]): string {
  const amount = leg.amount;
  const digits = amount >= 1000 ? 0 : amount >= 1 ? 2 : 6;
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: digits })} ${leg.symbol}`;
}

/** Where a transaction can be read in full. Null — we have no explorer for it. */
export function explorerUrl(flow: FlowDto): string | null {
  switch (flow.chain) {
    case 'BTC':
      return `https://mempool.space/tx/${flow.txHash}`;
    case 'TRON':
      return `https://tronscan.org/#/transaction/${flow.txHash}`;
    case 'SOL':
      return `https://solscan.io/tx/${flow.txHash}`;
    case 'EVM':
      // One EVM wallet holds positions on a dozen networks and the transaction
      // is on exactly one of them; blockscan's router is what turns a hash into
      // the right chain's explorer without a table of fifty of them here
      return `https://blockscan.com/tx/${flow.txHash}`;
    default:
      return null;
  }
}
