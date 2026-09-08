import type { Chain } from '@svinooh/shared';

// Money moved to the kit, because the assistant's charts write the same
// figures as the portfolio's and there must not be two answers to how. Imported
// as well as re-exported: the formatters below build on it.
import { fmtUsd, fmtUsdShort } from '@svinooh/ui/money';

export { fmtUsd, fmtUsdShort };

/** Price: small values with 7 decimals, otherwise normal (_fmtPrice) */
export function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  return p < 0.01 && p > 0 ? '$' + p.toFixed(7) : fmtUsd(p);
}

/** Token amount (_fmtAmt) */
export function fmtAmount(a: number | null | undefined): string {
  if (a === null || a === undefined) return '';
  const abs = Math.abs(a);
  if (abs >= 1000) return a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  // Below 4 decimals everything collapses to a bare "0" — and accrued LP fees
  // in a token like cbBTC genuinely live down there
  if (abs > 0 && abs < 0.0001) return a.toPrecision(2);
  if (abs < 1) return a.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return a.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Compact $ formatting for large leaderboard amounts */
export function fmtUsd0(value: number): string {
  return '$' + Math.round(value).toLocaleString('en-US');
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function syncedLabel(iso: string | null): string {
  if (!iso) return 'never';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  // Never "just now". It was true for one second and then quietly became a
  // lie — the page stays open, the label doesn't, and a portfolio claiming to
  // be current when it is twenty minutes old is the one thing this line must
  // not do. A number is always answerable.
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const CHAIN_META: Record<Chain, { label: string; color: string; name: string }> = {
  EVM: { label: 'EVM', color: '#627EEA', name: 'EVM wallet' },
  SOL: { label: 'SOL', color: '#9945FF', name: 'Solana wallet' },
  TRON: { label: 'TRON', color: '#EB0029', name: 'TRON wallet' },
  BTC: { label: 'BTC', color: '#F7931A', name: 'Bitcoin wallet' },
};

export const chainMeta = (chain: Chain) => CHAIN_META[chain];

/**
 * How a portfolio is labelled. Its id is the identity; a name is optional and
 * only exists if the owner set one. Never invent one — a made-up name either
 * says nothing to a stranger or names a single wallet, which misrepresents a
 * group of them.
 */
export function portfolioLabel(name: string | null, slug: string): string {
  return name?.trim() || slug;
}

/** Displayed wallet name: user-defined or the chain default */
export function walletName(label: string | null, chain: Chain): string {
  return label || CHAIN_META[chain].name;
}
