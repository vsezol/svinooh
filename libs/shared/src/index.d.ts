// The Svinooh API contract. Used by both the backend (NestJS) and the frontend (React).
// Types only: the package isn't built and has no runtime code.

export type Chain = 'BTC' | 'EVM' | 'SOL' | 'TRON';

export type WalletSyncStatus = 'pending' | 'ok' | 'failed';

export type PositionCategory = 'token' | 'defi' | 'staked' | 'unpriced';

/**
 * What a leg contributes to a DeFi position:
 *   supply — deposited/provided (counts towards the value)
 *   reward — accrued but not yet claimed: LP fees, farming rewards
 *   borrow — debt (`valueUsd` is negative — it subtracts from the position)
 */
export type PositionTokenRole = 'supply' | 'reward' | 'borrow';

/** One underlying leg of a DeFi position — what the position actually holds */
export interface PositionTokenDto {
  symbol: string;
  amount?: number | null;
  priceUsd?: number | null;
  /** Signed: borrow legs come through negative */
  valueUsd: number;
  role: PositionTokenRole;
}

export interface PositionDto {
  id: string;
  /** Protocol or ticker: "BTC", "USDT", "Pendle V2", "Hyperliquid" */
  symbol: string;
  /** Position kind: "Lending", "Liquidity Pool", "Deposit", "Staked" */
  name?: string | null;
  /** Extra detail: chain, pool/market name, the protocol's own description */
  note?: string | null;
  amount?: number | null;
  priceUsd?: number | null;
  valueUsd: number;
  /** Platform: 'wallet' | 'kamino' | 'meteora' | 'gmtrade' | 'arb_pendle2' | ... */
  platform?: string | null;
  category: PositionCategory;
  /** Yield as a fraction (0.42 = 42% APY), when the source reports one */
  apy?: number | null;
  /** Health factor of a lending position (below 1 — liquidation) */
  healthRate?: number | null;
  /** Underlying legs: what's supplied, what's accrued, what's borrowed */
  tokens?: PositionTokenDto[] | null;
}

export interface WalletDto {
  id: string;
  address: string;
  chain: Chain;
  /** User-defined name (set by the owner). null — the frontend shows the chain default */
  label: string | null;
  /** null — no successful scan yet */
  totalUsd: number | null;
  status: WalletSyncStatus;
  /** Last successful scan is older than 3× the refresh interval */
  stale: boolean;
  lastSyncedAt: string | null;
  lastError?: string | null;
  /** For example { defi, gmtrade } for SOL, or a breakdown by EVM chains */
  breakdown?: Record<string, number> | null;
  positions: PositionDto[];
  /** Assets with no price found (not lost, just not valued) */
  unpriced?: string[];
  createdAt: string;
}

export interface PortfolioOwnerDto {
  name: string;
  username?: string | null;
  photoUrl?: string | null;
}

export interface PortfolioDto {
  slug: string;
  name: string;
  owner: PortfolioOwnerDto;
  totalUsd: number;
  /** Sorted by totalUsd descending; pending ones at the end */
  wallets: WalletDto[];
  isOwner: boolean;
  /** The most recent lastSyncedAt among the wallets */
  updatedAt: string | null;
  createdAt: string;
}

export interface PublicPortfolioDto {
  slug: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
  totalUsd: number;
  walletCount: number;
  chains: Chain[];
}

export type HistoryRange = '24h' | '7d' | '30d' | 'all';

export interface HistoryPointDto {
  t: string;
  usd: number;
}

export interface HistoryDto {
  range: HistoryRange;
  points: HistoryPointDto[];
}

export interface AuthConfigDto {
  botUsername: string | null;
  /** Numeric bot id (public, the token prefix) — for Telegram.Login.auth */
  botId: string | null;
  devMode: boolean;
  syncIntervalMin: number;
}

export interface MeDto {
  id: string;
  name: string;
  username?: string | null;
  photoUrl?: string | null;
  portfolioSlug: string;
}

export interface AuthResponseDto {
  token: string;
  me: MeDto;
}

/** Start bot sign-in: a link that opens the Telegram app */
export interface TelegramStartDto {
  token: string;
  botUsername: string;
  deepLink: string;
}

/** Poll the bot sign-in status: either still waiting, or a completed login */
export type TelegramPollDto = { pending: true } | AuthResponseDto;

/** What the Telegram Login Widget sends to onauth */
export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface ApiErrorDto {
  statusCode: number;
  message: string;
  /** Machine-readable code: UNSUPPORTED_NETWORK, WALLET_EXISTS, ... */
  code?: string;
}
