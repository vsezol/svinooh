import { Decimal } from 'decimal.js';

const str = (name: string, fallback: string): string => process.env[name] ?? fallback;

const int = (name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is not a number: ${raw}`);
  const whole = Math.trunc(parsed);
  if (whole < min || whole > max) throw new Error(`${name} is out of range: ${raw}`);
  return whole;
};

const float = (name: string, fallback: number, min: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`${name} is not valid: ${raw}`);
  return parsed;
};

const csv = (name: string, fallback: string, lower = false): string[] =>
  str(name, fallback)
    .split(',')
    .map((part) => (lower ? part.trim().toLowerCase() : part.trim()))
    .filter(Boolean);

export interface Settings {
  kaminoApi: string;
  solanaRpcUrl: string;
  httpTimeoutMs: number;
  httpConcurrency: number;
  refreshIntervalMs: number;
  staleAfterMs: number;
  catalogHistory: number;
  startupGraceMs: number;
  minTvlUsd: Decimal;
  includeReserves: boolean;
  defaultPageSize: number;
  maxPageSize: number;
  excludedNameMarks: string[];
  corsOrigins: string[];
  port: number;
}

export function settingsFromEnv(): Settings {
  return {
    kaminoApi: str('EARN_KAMINO_API', 'https://api.kamino.finance'),
    solanaRpcUrl: str('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    httpTimeoutMs: float('EARN_HTTP_TIMEOUT_S', 20, 0.001) * 1000,
    httpConcurrency: int('EARN_HTTP_CONCURRENCY', 8, 1, 64),
    refreshIntervalMs: int('EARN_REFRESH_INTERVAL_S', 300, 10) * 1000,
    staleAfterMs: int('EARN_STALE_AFTER_S', 900, 10) * 1000,
    catalogHistory: int('EARN_CATALOG_HISTORY', 3, 1, 20),
    startupGraceMs: float('EARN_STARTUP_GRACE_S', 45, 0) * 1000,
    minTvlUsd: new Decimal(str('EARN_MIN_TVL_USD', '100000')),
    includeReserves: str('EARN_INCLUDE_RESERVES', 'true').toLowerCase() !== 'false',
    defaultPageSize: int('EARN_DEFAULT_PAGE_SIZE', 20, 1),
    maxPageSize: int('EARN_MAX_PAGE_SIZE', 100, 1),
    excludedNameMarks: csv('EARN_EXCLUDED_NAME_MARKS', 'test,staging,mock,demo', true),
    corsOrigins: csv('EARN_CORS_ORIGINS', ''),
    port: int('PORT', 3000, 1, 65535),
  };
}
