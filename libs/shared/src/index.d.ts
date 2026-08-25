// Контракт API «Свиноуха». Используется и бэкендом (NestJS), и фронтом (React).
// Только типы: пакет не собирается и не имеет рантайм-кода.

export type Chain = 'BTC' | 'EVM' | 'SOL' | 'TRON';

export type WalletSyncStatus = 'pending' | 'ok' | 'failed';

export type PositionCategory = 'token' | 'defi' | 'staked' | 'unpriced';

export interface PositionDto {
  id: string;
  /** Тикер или имя позиции: "BTC", "USDT", "GM:SOL[WSOL-USDC]", "Lending" */
  symbol: string;
  /** Вторая строка: имя рынка/пула, если есть */
  name?: string | null;
  amount?: number | null;
  priceUsd?: number | null;
  valueUsd: number;
  /** Платформа: 'wallet' | 'kamino' | 'meteora' | 'gmtrade' | 'debank' | ... */
  platform?: string | null;
  category: PositionCategory;
}

export interface WalletDto {
  id: string;
  address: string;
  chain: Chain;
  /** Пользовательское имя (владелец задаёт). null — фронт показывает дефолт по сети */
  label: string | null;
  /** null — ещё ни одного успешного скана */
  totalUsd: number | null;
  status: WalletSyncStatus;
  /** Последний успешный скан старше 3× интервала обновления */
  stale: boolean;
  lastSyncedAt: string | null;
  lastError?: string | null;
  /** Например { defi, gmtrade } для SOL или разбивка по EVM-сетям */
  breakdown?: Record<string, number> | null;
  positions: PositionDto[];
  /** Активы, для которых не нашлось цены (не потеряны, просто не оценены) */
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
  /** Отсортированы по totalUsd по убыванию; pending — в конце */
  wallets: WalletDto[];
  isOwner: boolean;
  /** Самый свежий lastSyncedAt среди кошельков */
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

/** Что присылает Telegram Login Widget в onauth */
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
  /** Машиночитаемый код: UNSUPPORTED_NETWORK, WALLET_EXISTS, ... */
  code?: string;
}
