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

/**
 * Whether a concentrated-liquidity position is still earning. Out of range means
 * the price left the position's band, so it sits entirely in one side of the
 * pair and collects no fees.
 */
export type PositionRange = 'in' | 'out';

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
  /**
   * What the debt on this position costs, as a positive fraction (0.06 = 6%
   * APY). Only where the source reports it — DeBank doesn't.
   */
  borrowApy?: number | null;
  /**
   * Concentrated liquidity only (Uniswap V3-style, Meteora DLMM): whether the
   * price is still inside the position's range. null — not applicable, or
   * unknown.
   */
  range?: PositionRange | null;
  /** Underlying legs: what's supplied, what's accrued, what's borrowed */
  tokens?: PositionTokenDto[] | null;
}

export interface WalletDto {
  id: string;
  address: string;
  chain: Chain;
  /**
   * User-defined name. Returned to the OWNER ONLY — a label is the owner's own
   * words and can identify them; everyone else gets null and sees the chain
   * default.
   */
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

/**
 * anonymous — belongs to nobody (created from a wallet search); always listed.
 * private  — someone's portfolio, not listed and not searchable; link only.
 * public   — someone's portfolio they chose to list.
 */
export type PortfolioVisibility = 'anonymous' | 'private' | 'public';

export interface PortfolioDto {
  /** The portfolio's public identity — what it is called when it has no name */
  slug: string;
  /** Owner-given name; null — none, and the slug stands in for it */
  name: string | null;
  /**
   * The owner's profile — sent to the OWNER ONLY, null for everyone else.
   * Showing who a balance belongs to is a deanonymization risk, so this never
   * leaves the API for a third party.
   */
  owner: PortfolioOwnerDto | null;
  visibility: PortfolioVisibility;
  totalUsd: number;
  /** Sorted by totalUsd descending; pending ones at the end */
  wallets: WalletDto[];
  isOwner: boolean;
  /** The most recent lastSyncedAt among the wallets */
  updatedAt: string | null;
  createdAt: string;
}

/**
 * A row in the landing list. Deliberately carries NOTHING about a person — no
 * handle, no photo, no name of an owner: these are listed publicly, and a
 * balance next to an identity is exactly what must never happen.
 */
export interface PublicPortfolioDto {
  slug: string;
  /** Owner-given name; null — none, and the slug stands in for it */
  name: string | null;
  totalUsd: number;
  walletCount: number;
  chains: Chain[];
  /** true — belongs to nobody; false — someone published it */
  anonymous: boolean;
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

/* ───────── scanning: the contract between the wallet service and the scanners ───────── */
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
  /** Cost of the debt as a positive fraction (0.06 = 6% APY) */
  borrowApy?: number | null;
  /** Concentrated liquidity only: is the price still inside the position's band */
  range?: PositionRange | null;
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
