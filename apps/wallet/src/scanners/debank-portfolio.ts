import type { PositionTokenRole } from '@svinooh/shared';
import type { ScanPosition, ScanPositionToken } from './types';

/**
 * Shape of the debank.com portfolio payloads, and how we turn them into
 * positions. Shared by both EVM paths: the signed HTTP call (evm-http.ts) and
 * the responses the rendered page makes on its own, which Chrome intercepts
 * (evm-browser.ts). Same JSON either way, so the same parsing.
 *
 * A protocol is NOT one position: `portfolio_item_list` splits it by kind
 * ("Lending", "Liquidity Pool", "Deposit", "Staked"), and each item carries the
 * legs it's actually made of — supply_token_list, reward_token_list (unclaimed
 * LP fees and farming rewards), borrow_token_list (debt).
 */

export interface DebankToken {
  chain?: string;
  symbol?: string;
  optimized_symbol?: string;
  display_symbol?: string;
  name?: string;
  amount?: number;
  price?: number;
  is_scam?: boolean;
}

export interface PortfolioItem {
  name?: string;
  detail_types?: string[];
  stats?: { asset_usd_value?: number; debt_usd_value?: number; net_usd_value?: number };
  detail?: Record<string, unknown>;
  pool?: { id?: string; chain?: string };
}

export interface DebankProject {
  id?: string;
  name?: string;
  chain?: string;
  portfolio_item_list?: PortfolioItem[];
}

export interface AppListResponse {
  apps?: DebankProject[];
  error_apps?: unknown[];
}

/** Item kinds that are staking rather than "generic DeFi" */
const STAKED_KINDS = /^(staked|locked|vesting|farming)$/i;

/**
 * Which leg a `*_token_list` in `detail` is. Anything ending in `_token_list`
 * that isn't listed here still comes through as a supply leg — DeBank keeps
 * adding kinds, and an unknown leg is better shown than dropped.
 */
const ROLE_BY_KEY: Record<string, PositionTokenRole> = {
  supply_token_list: 'supply',
  asset_token_list: 'supply',
  token_list: 'supply',
  reward_token_list: 'reward',
  borrow_token_list: 'borrow',
};

export const tokenSymbol = (t: DebankToken): string =>
  t.optimized_symbol || t.display_symbol || t.symbol || t.name || '???';

export const projectNetUsd = (project: DebankProject): number =>
  (project.portfolio_item_list || []).reduce((sum, item) => sum + (item.stats?.net_usd_value || 0), 0);

/** Legs of one portfolio item, in display order: supplied → accrued → borrowed */
function itemTokens(detail: Record<string, unknown> | undefined): ScanPositionToken[] {
  if (!detail) return [];
  const legs: ScanPositionToken[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (!key.endsWith('_token_list') || !Array.isArray(value)) continue;
    const role = ROLE_BY_KEY[key] ?? 'supply';
    for (const raw of value as DebankToken[]) {
      const amount = raw?.amount ?? 0;
      const price = raw?.price ?? 0;
      const usd = amount * price;
      if (Math.abs(usd) < 0.01) continue; // dust leg — noise, not detail
      legs.push({
        symbol: tokenSymbol(raw),
        amount,
        priceUsd: price,
        valueUsd: role === 'borrow' ? -usd : usd,
        role,
      });
    }
  }
  const order: Record<PositionTokenRole, number> = { supply: 0, reward: 1, borrow: 2 };
  return legs.sort((a, b) => order[a.role] - order[b.role] || Math.abs(b.valueUsd) - Math.abs(a.valueUsd));
}

/** Free-form extra line: chain, the protocol's description, perp side/leverage */
function itemNote(item: PortfolioItem, projectChain: string | undefined): string | null {
  const detail = item.detail || {};
  const parts: string[] = [];
  const chain = item.pool?.chain || projectChain;
  if (chain) parts.push(chain);
  if (typeof detail.description === 'string' && detail.description) parts.push(detail.description);
  // Perpetuals: DeBank reports the direction and leverage separately from the legs
  if (typeof detail.side === 'string' && detail.side) {
    const leverage = typeof detail.leverage === 'number' ? `${detail.leverage.toFixed(1)}x` : null;
    parts.push([detail.side, leverage].filter(Boolean).join(' '));
  }
  return parts.length ? parts.join(' · ') : null;
}

/** One position per portfolio item — a protocol is usually several of them */
export function itemPositions(project: DebankProject): ScanPosition[] {
  const positions: ScanPosition[] = [];
  for (const item of project.portfolio_item_list || []) {
    const usd = item.stats?.net_usd_value || 0;
    if (usd < 0.01) continue; // dust item — kept in the total, not worth a row
    const detail = item.detail || {};
    positions.push({
      symbol: project.name || project.id || 'DeFi',
      name: item.name || item.detail_types?.[0] || null,
      note: itemNote(item, project.chain),
      valueUsd: usd,
      platform: project.id || 'debank',
      category: STAKED_KINDS.test(item.name || '') ? 'staked' : 'defi',
      healthRate: typeof detail.health_rate === 'number' ? detail.health_rate : null,
      tokens: itemTokens(detail),
    });
  }
  return positions;
}

/** A held token as a position (scams are excluded — DeBank leaves them out of the total too) */
export function tokenPosition(token: DebankToken): ScanPosition | null {
  if (token.is_scam) return null;
  const amount = token.amount || 0;
  const price = token.price || 0;
  const usd = amount * price;
  if (usd < 0.01) return null;
  return {
    symbol: tokenSymbol(token),
    note: token.chain ?? null,
    amount,
    priceUsd: price,
    valueUsd: usd,
    platform: 'wallet',
    category: 'token',
  };
}
