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
  /**
   * The network this sits on, as the source names it: `eth`, `arb`, `base`,
   * `op`, `sol`, `tron`, `btc`.
   *
   * Distinct from `Chain`, which is the family a wallet belongs to. One EVM
   * wallet holds positions on a dozen networks, and "EVM" cannot say which —
   * the scanners have always known, and used to fold it into the free text of
   * `note`, where it could only be read by a human.
   */
  network?: string | null;
  /** A borrow leg's own rate, as a fraction, where the source reports one */
  apy?: number | null;
}

export interface PositionDto {
  id: string;
  /** Protocol or ticker: "BTC", "USDT", "Pendle V2", "Hyperliquid" */
  symbol: string;
  /** Position kind: "Lending", "Liquidity Pool", "Deposit", "Staked" */
  name?: string | null;
  /** Extra detail: pool/market name, the protocol's own description */
  note?: string | null;
  /**
   * The network this sits on, as the source names it: `eth`, `arb`, `base`,
   * `op`, `sol`, `tron`, `btc`.
   *
   * Distinct from `Chain`, which is the family a wallet belongs to. One EVM
   * wallet holds positions on a dozen networks, and "EVM" cannot say which —
   * the scanners have always known, and used to fold it into the free text of
   * `note`, where it could only be read by a human.
   */
  network?: string | null;

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
  /**
   * The band itself, where the protocol answered for it — see PositionBand.
   * `range` says whether the price is inside it; this says WHERE inside, which
   * is the difference between comfortable and one bad hour from earning
   * nothing.
   */
  band?: PositionBand | null;
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
  /**
   * TRON only: energy, bandwidth and what this wallet has delegated out. Public,
   * like every other number here — it is a fact about an address that anyone can
   * read off the chain, and it says nothing about who owns it.
   */
  tron?: TronResourcesDto | null;
  createdAt: string;
}

/** TronResources as the API answers it, plus what the page would otherwise re-derive */
export interface TronResourcesDto extends TronResources {
  /** When these numbers were read — they are refreshed on a slower clock than the balance */
  readAt: string;
  /** A delegation is unlocked and can be taken back right now */
  reclaimableNow: boolean;
  /** When the earliest still-locked delegation unlocks. ISO 8601, or null */
  nextReclaimAt: string | null;
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
  /**
   * Whether this person may see the admin tab.
   *
   * The flag decides what the browser RENDERS, and nothing more — every admin
   * route checks the database again for itself. A client that lies about this
   * gets a tab full of controls whose every request comes back 404.
   */
  isAdmin: boolean;
}

/**
 * One tunable, as the admin panel shows it.
 *
 * Mirrors SettingView in @svinooh/common — the browser cannot import from a
 * service library, so the shape is restated here and the compiler checks the
 * two agree at the point the service returns one.
 */
export interface SettingDto {
  key: string;
  group: string;
  label: string;
  about: string;
  /** `number` — between min and max; `choice` — one of `options` */
  kind: 'number' | 'choice';
  value: number | string;
  default: number | string;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  /** False — whoever reads this knob picks the change up on its next deploy */
  live: boolean;
  note?: string;
  /** Which services read it, for when a change seems to do nothing */
  readBy: string[];
}

export interface SettingsDto {
  settings: SettingDto[];
}

/**
 * What to change: the body IS the patch, keys left out are left alone.
 *
 * No envelope. A `{ values: … }` wrapper bought nothing and cost a layer of
 * unwrapping that was, briefly, forgotten — every key then read as "not a
 * setting" because the parser was looking at the envelope.
 */
export type UpdateSettingsDto = Record<string, number | string>;

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
  /**
   * The network this sits on, as the source names it: `eth`, `arb`, `base`,
   * `op`, `sol`, `tron`, `btc`.
   *
   * Distinct from `Chain`, which is the family a wallet belongs to. One EVM
   * wallet holds positions on a dozen networks, and "EVM" cannot say which —
   * the scanners have always known, and used to fold it into the free text of
   * `note`, where it could only be read by a human.
   */
  network?: string | null;
  /**
   * What this leg's rate is, as a fraction. Only borrow legs carry one, and
   * only where the source reports per-leg rates — a position-wide figure
   * belongs on the position, not stamped onto every leg of it.
   */
  apy?: number | null;
}

export interface ScanPosition {
  /** Protocol or ticker: "Pendle V2", "USDT" */
  symbol: string;
  /** Position kind: "Lending", "Liquidity Pool", "Deposit" */
  name?: string | null;
  /** Extra detail: pool/market name, the protocol's own description */
  note?: string | null;
  /**
   * The network this sits on, as the source names it: `eth`, `arb`, `base`,
   * `op`, `sol`, `tron`, `btc`.
   *
   * Distinct from `Chain`, which is the family a wallet belongs to. One EVM
   * wallet holds positions on a dozen networks, and "EVM" cannot say which —
   * the scanners have always known, and used to fold it into the free text of
   * `note`, where it could only be read by a human.
   */
  network?: string | null;

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
  /**
   * TRON only, and only on the scans that refreshed it — reading it costs four
   * or more sequential rate-limited calls, so it is refreshed on its own slower
   * clock (TRON_RESOURCE_INTERVAL_MIN) rather than on every sync.
   *
   * `undefined` means this scan did not look; whatever is stored stays. That is
   * different from a wallet that has no resources to report, which still
   * answers with zeroes.
   */
  tron?: TronResources;
}

/**
 * One delegation of a Tron resource to somebody else.
 *
 * The lock is `expireAt`, and **0 means there is no lock** — delegated without
 * one, reclaimable at any moment. A missing lock and an expired lock are the
 * same thing to everything that reads this, which is why both answer "now".
 */
export interface TronDelegation {
  type: 'energy' | 'bandwidth';
  /** ms since the epoch; 0 — no lock at all */
  expireAt: number;
}

/**
 * What a Tron wallet can spend and what it has lent out.
 *
 * Tron does not charge fees in TRX so much as in *resources*: energy runs
 * contract calls, bandwidth pays for the bytes of a transaction, and both
 * regenerate. Staked TRX can be delegated to another account, which is how most
 * people use a second wallet — and that is the part worth watching, because a
 * delegation locks and later unlocks, and the moment it unlocks is a thing its
 * owner wants to act on.
 *
 * Free/total rather than used: what is left is the number anybody actually
 * makes a decision on.
 */
export interface TronResources {
  energyFree: number;
  energyTotal: number;
  bandwidthFree: number;
  bandwidthTotal: number;
  /** Delegated out, in resource units */
  delegatedEnergy: number;
  /** ...and what that is worth in staked TRX */
  delegatedEnergyTrx: number;
  delegatedBandwidth: number;
  delegatedBandwidthTrx: number;
  delegations: TronDelegation[];
  hasDelegation: boolean;
}

/**
 * What a Tron wallet's owner could do right now. Not measurements — actions.
 *
 * Deliberately booleans and not thresholds: there is no useful number to set a
 * line at, only "the delegation came unlocked" and "there is something free to
 * delegate". Both carry the bandwidth a transaction needs, because being told
 * you can reclaim when you cannot pay for the reclaim is not being told
 * anything.
 */
export interface TronFlags {
  /** A delegation is unlocked AND there is bandwidth to send the reclaim */
  reclaim: boolean;
  /** Free energy AND bandwidth AND nothing currently delegated */
  delegate: boolean;
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
  /** TRON: a delegation came unlocked and there is bandwidth to take it back */
  tronReclaimAlerts: boolean;
  /** TRON: resources are free and nothing is delegated — they could be put to work */
  tronDelegateAlerts: boolean;
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
  tronReclaimAlerts?: boolean;
  tronDelegateAlerts?: boolean;
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
  /** The ADDRESS's row, not a portfolio's hold on it — one message serves them all */
  walletId: string;
  address: string;
  chain: Chain;
  positions: WalletPositionState[];
  /** Protocols that could not be reached on this scan, by platform */
  unreachable: string[];
  /**
   * TRON only: the wallet's resources as of this scan, or null when there are
   * none to report yet. It rides along rather than being read back by the
   * collector for the same reason the positions do — what a scan saw is the
   * scan's to say, and re-reading it later would be judging a different moment.
   */
  tron?: TronResources | null;
  /** ISO 8601 */
  at: string;
}

/**
 * Why somebody is being told about a wallet.
 *
 * `range`, `health` and `borrow` are about one position. `reclaim` and
 * `delegate` are about the Tron wallet itself — it has no positions to speak
 * of, it has resources — which is why an item carries no reading and no
 * threshold for them.
 */
export type AlertKind = 'range' | 'health' | 'borrow' | 'reclaim' | 'delegate';

/**
 * A single thing that changed and was worth saying.
 *
 * `direction` is which side of the line the position is on, not how bad it is:
 * `entered` is a position in the state its owner asked to hear about, and
 * `recovered` is one that has come back out of it. Both are worth a message —
 * being told the danger has passed is half of why anybody turns an alert on.
 *
 * A range only ever produces one on the crossing. A health factor or a borrow
 * rate produces one on every check for as long as it stands, so `entered` there
 * means "is", not "has just".
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
  /**
   * The wallet's resources at the moment a `reclaim`/`delegate` alert fired.
   * null on every other kind — and on those two it is the whole message, since
   * what makes "you can reclaim now" worth reading is how much of what.
   */
  tron?: TronResources | null;
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
/**
 * "Nobody has opened this in a while, so we have slowed down."
 *
 * Sent once per quiet spell, not once per check: see PortfolioOwner
 * .slowedNoticeAt. Visiting the portfolio is what makes it sendable again, and
 * also what restores the rate — which is the whole message.
 */
export interface SlowedNotice {
  telegramId: string;
  portfolioSlug: string;
  /** The owner's own name for it, or null — the bot falls back to the slug */
  portfolioName: string | null;
  /** How long they were away before we slowed down, in minutes */
  quietForMin: number;
  /** What the interval was, and what it is now */
  wasEveryMin: number;
  nowEveryMin: number;
}

export interface AlertEvent {
  telegramId: string;
  portfolioSlug: string;
  /** The owner's own label for the wallet, or null — the bot falls back to the network */
  walletLabel: string | null;
  walletAddress: string;
  chain: Chain;
  items: AlertItem[];
}
