import type { Chain } from '@svinooh/shared';

/**
 * $12,345.60 — as in the design (_fmt$). A negative amount reads "-$2,013.36":
 * the sign belongs in front of the currency, not between it and the digits.
 */
export function fmtUsd(value: number | null | undefined, dec = 2): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return (
    sign +
    '$' +
    Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  );
}

/** Price: small values with 7 decimals, otherwise normal (_fmtPrice) */
export function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  return p < 0.01 && p > 0 ? '$' + p.toFixed(7) : fmtUsd(p);
}

/** "$1,234" / "-$1,234" — compact, for the summary strips */
export function fmtUsdShort(value: number): string {
  return (value < 0 ? '-$' : '$') + Math.round(Math.abs(value)).toLocaleString('en-US');
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
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
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

/** Displayed wallet name: user-defined or the chain default */
export function walletName(label: string | null, chain: Chain): string {
  return label || CHAIN_META[chain].name;
}
