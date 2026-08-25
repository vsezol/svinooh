import type { Chain, PositionCategory, PositionTokenRole } from '@svinooh/shared';

/** One underlying leg of a DeFi position (supplied / accrued / borrowed) */
export interface ScanPositionToken {
  symbol: string;
  amount?: number | null;
  priceUsd?: number | null;
  /** Signed: borrow legs are negative */
  valueUsd: number;
  role: PositionTokenRole;
}

export interface ScanPosition {
  /** Protocol or ticker: "Pendle V2", "USDT" */
  symbol: string;
  /** Position kind: "Lending", "Liquidity Pool", "Deposit" */
  name?: string | null;
  /** Extra detail: chain, pool/market name, the protocol's own description */
  note?: string | null;
  amount?: number | null;
  priceUsd?: number | null;
  valueUsd: number;
  platform?: string | null;
  category: PositionCategory;
  /** Yield as a fraction (0.42 = 42% APY) */
  apy?: number | null;
  /** Health factor of a lending position */
  healthRate?: number | null;
  tokens?: ScanPositionToken[] | null;
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
