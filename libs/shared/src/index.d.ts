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

/**
 * The width of the window the chart draws, not how much history it is given:
 * 24H means a day fills the width and the days before it are scrolled back to.
 * `all` is the exception — the whole history at a glance, with nothing either
 * side of it.
 */
export type HistoryRange = '1h' | '24h' | '7d' | '30d' | 'all';

export interface HistoryPointDto {
  t: string;
  usd: number;
  /**
   * What could have been collected, and what was owed, at that moment.
   *
   * `null` for a reading taken before either was recorded — which is every
   * reading older than the release that started storing them. A chart draws
   * from where the readings begin rather than pretending a portfolio owed
   * nothing before we started counting.
   */
  claimableUsd: number | null;
  debtUsd: number | null;
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
  /** The band itself, when the protocol answered for it — see PositionBand */
  band?: PositionBand | null;
  /** Which loan this is, when a lending market answered for it */
  loan?: PositionLoan | null;
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

/**
 * What one wallet is watched for, and told about over Telegram.
 *
 *   GET   /api/portfolios/:slug/alerts                   → AlertSettingsDto
 *   PATCH /api/portfolios/:slug/wallets/:walletId/alerts → WalletAlertsDto
 *
 * Both owner-only. What somebody watches their own money for says as much about
 * them as the money does, so it is never part of the portfolio a link hands to a
 * stranger — it is fetched separately, by the one person entitled to it.
 *
 * A wallet nobody has configured still answers, with the defaults. The client is
 * then never in the position of inventing a threshold and showing it as if the
 * server had agreed to it.
 */
export interface WalletAlertsDto {
  walletId: string;
  /** An LP position leaving its liquidity range — or coming back into it */
  rangeAlerts: boolean;
  /** Told when the health factor falls below this. null — nobody is watching */
  healthFactorBelow: number | null;
  /** Told when the borrow rate climbs above this, in percent. null — not watched */
  borrowApyAbove: number | null;
}

export interface AlertSettingsDto {
  /** Every wallet in the portfolio that has finished its first sync */
  wallets: WalletAlertsDto[];
}

/** A patch: a field left out is a field left alone */
export interface UpdateWalletAlertsDto {
  rangeAlerts?: boolean;
  healthFactorBelow?: number | null;
  borrowApyAbove?: number | null;
}

/**
 * A concentrated position's band, as the protocol that owns it describes it.
 *
 * Nothing here changes what a position is worth or whether it is in range — it
 * is what a message needs in order to be worth reading. "Out of range" tells
 * somebody to go and look; "out of range at 2522.70, band 2248.50 — 2519.99"
 * tells them how far out and which way, which is most of what they were going
 * to look for.
 */
export interface PositionBand {
  /** The pair as the protocol writes it, in its own order: "cbBTC/USDC" */
  pair: string;
  /** Fee tier in percent — 0.04 is 0.04%. null when the protocol did not say */
  feePct: number | null;
  /** The network the pool is on: "Solana", "Base" */
  chainLabel: string;
  lower: number;
  upper: number;
  current: number;
  /** Which way round the three prices read: "USDC per cbBTC" */
  priceLabel: string;
}

/** Which loan a lending alert is about, when the market answered for it */
export interface PositionLoan {
  /** The market's own name: "Main Market", "Aave V3 Base" */
  market: string;
  /** Upper-cased symbol of the borrowed asset */
  token: string;
}

/**
 * What a protocol's own API knows about a position that an aggregator does not.
 *
 * A fact never becomes a position. Jupiter and DeBank decide what a wallet holds
 * and what it is worth; a fact only answers what they left blank — whether a
 * concentrated position is inside its band, and what a loan's health and rate
 * are. A protocol that disagrees about value is not consulted about it.
 */
export interface PoolFact {
  /** Stable across cycles: the protocol's own address for this position */
  id: string;
  platform: 'orca' | 'meteora' | 'uniswap';
  /** The pair, upper-cased and ordered, e.g. "CBBTC|USDC" — how a fact finds its position */
  pair: string;
  /** The same pair as it is written and ordered by the protocol: "cbBTC/USDC" */
  pairLabel: string;
  /** Fee tier in percent — 0.04 is 0.04%. null when the protocol did not say */
  feePct: number | null;
  /** The network the pool is on: "Solana", "Base" */
  chainLabel: string;
  inRange: boolean;
  lowerPrice: number;
  upperPrice: number;
  currentPrice: number;
  /** "USDC per cbBTC" */
  priceLabel: string;
  isFullRange: boolean;
}

/** What a lending market says about a loan, per borrowed asset */
export interface LendingFact {
  id: string;
  platform: 'kamino' | 'aave';
  market: string;
  /** Upper-cased symbol of the borrowed asset — how a fact finds its position */
  token: string;
  healthFactor: number;
  /** Borrow APY as a percentage: 6.2 is 6.2% */
  borrowRate: number | null;
}

/**
 * Everything the protocols could see this cycle, and which of them could not.
 *
 * `failed` matters as much as the facts: a source that threw has told us
 * nothing, and nothing is not the same as "no positions". Anything that decides
 * what changed since last time has to keep the two apart, or it will report
 * every position of a briefly unreachable protocol as gone.
 */
export interface DefiFacts {
  pools: PoolFact[];
  lending: LendingFact[];
  /** Sources that could not be reached, by platform */
  failed: string[];
}

/**
 * One thing in a wallet that can be alerted on, and the key that recognises it
 * next time.
 *
 * The key has to survive a sync, and a `Position` row does not: every scan
 * deletes the wallet's positions and writes them again, so their ids are new
 * each time. Where a protocol answered for itself the key is its own address
 * for the position, which is as stable as identity gets. Where only the
 * aggregator saw it, the key is built from the platform and what it is called —
 * stable while the protocol keeps calling it the same thing, and a renamed
 * position simply reads as a new one and re-baselines quietly.
 */
export interface WalletPositionState {
  key: string;
  /** The protocol, which is what a message groups by: "Meteora", "Aave" */
  platform: string;
  /** What this position is within that protocol: "cbBTC/USDC", "Lending" */
  label: string;
  /** null — not a position with a band, or nobody could say */
  inRange: boolean | null;
  healthFactor: number | null;
  /** Percent, as the thresholds are written: 6.2 is 6.2% */
  borrowApyPct: number | null;
  /** Where the band is and where the price stands in it, or null */
  band: PositionBand | null;
  /** Which loan this is, or null */
  loan: PositionLoan | null;
}

/**
 * What a wallet looked like the moment a scan landed.
 *
 * Published by the wallet service and read by whatever decides who should hear
 * about it. It carries no owner and no settings on purpose: who watches this
 * wallet and what they asked to be told is the reader's business, and a scan
 * should not have to know.
 *
 * `unreachable` is as important as the positions. A protocol that could not be
 * reached has said nothing, and a reader that treats silence as "no positions"
 * will announce that every position of a briefly unreachable protocol has gone.
 */
export interface WalletStateEvent {
  walletId: string;
  portfolioId: string;
  address: string;
  chain: Chain;
  positions: WalletPositionState[];
  /** Protocols that could not be reached on this scan, by platform */
  unreachable: string[];
  /** ISO 8601 */
  at: string;
}

/** Why somebody is being told about a position */
export type AlertKind = 'range' | 'health' | 'borrow';

/**
 * A single thing that changed and was worth saying.
 *
 * `direction` is what actually happened, not how bad it is: `entered` is a
 * position that has just crossed into the state its owner asked to hear about,
 * `recovered` is one that has come back out of it. Both are worth a message —
 * being told the danger has passed is half of why anybody turns an alert on.
 */
export interface AlertItem {
  kind: AlertKind;
  direction: 'entered' | 'recovered';
  /** The protocol the message groups this under: "Meteora", "Aave" */
  platform: string;
  /** What to call the position within it: "cbBTC/USDC", "Lending" */
  position: string;
  /** What the reading was: the health factor, or the rate in percent */
  value: number | null;
  /** The threshold it crossed, in the same units. null for a range, which has no number */
  threshold: number | null;
  /** The band and where the price stands in it — a range alert with nothing to add says null */
  band: PositionBand | null;
  /** Which loan a health or borrow alert is about, when the market said */
  loan: PositionLoan | null;
}

/**
 * Something a person asked to be told, addressed to them.
 *
 * Published by the alert collector and read by the bot. It carries the Telegram
 * id rather than a user id because the bot has no database and no business
 * having one: it is a view, and everything it needs to send a message is here.
 *
 * Nothing identifying anybody else is in it. A wallet address and a portfolio
 * slug belong to the person being written to, which is the only person who will
 * ever see this.
 */
export interface AlertEvent {
  telegramId: string;
  portfolioSlug: string;
  /** The owner's own label for the wallet, or null — the bot falls back to the network */
  walletLabel: string | null;
  walletAddress: string;
  chain: Chain;
  items: AlertItem[];
}
