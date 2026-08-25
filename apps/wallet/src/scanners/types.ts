import type { Chain, PositionCategory } from '@svinooh/shared';

export interface ScanPosition {
  symbol: string;
  name?: string | null;
  amount?: number | null;
  priceUsd?: number | null;
  valueUsd: number;
  platform?: string | null;
  category: PositionCategory;
}

export interface ScanResult {
  chain: Chain;
  address: string;
  totalUsd: number;
  positions: ScanPosition[];
  /** For example { defi, gmtrade } for SOL, or a per-chain breakdown for EVM */
  breakdown?: Record<string, number>;
  /** Assets without a price: we log and surface them rather than silently swallowing them */
  unpriced?: string[];
}
