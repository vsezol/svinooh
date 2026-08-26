import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { int } from '@svinooh/common';

// .env lives at the root of apps/api. At runtime __dirname is apps/api/dist
// (after nest build) or apps/api/src (under tsx) — in both cases ../.env is
// correct. Real environment variables take priority over the file (--env-file
// semantics).
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // no permissions or a corrupt file — we run with whatever is in the environment
  }
}

// PrismaClient reads DATABASE_URL from process.env via schema.prisma
process.env.DATABASE_URL ??= 'postgresql://svinooh:svinooh@localhost:5432/svinooh';

/**
 * The gateway's config. Sign-in lives in the auth service and scanning in the
 * wallet service, so nothing about Telegram, RabbitMQ or the scanners belongs
 * here — the api only needs to know how to reach those two services, its cache
 * and its database.
 */
export const config = {
  port: int(process.env.PORT, 3000),
  // Only verifies tokens — they're issued by the auth service with the same secret
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  // Internal URL of the auth service — the gateway forwards /auth/* to it.
  authServiceUrl: (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, ''),
  // Internal URL of the wallet service — scan-on-add is delegated to it.
  walletServiceUrl: (process.env.WALLET_SERVICE_URL || 'http://localhost:3002').replace(/\/+$/, ''),
  // How often the wallet service rescans a wallet that's in use. Used for the
  // "stale" flag (3× this) and reported to the frontend, so it MUST match the
  // wallet service's SYNC_INTERVAL_MIN — set it lower and every wallet reads as
  // stale the moment it is scanned on time.
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
  // Redis for the assembled-portfolio cache. Empty — an in-memory cache, so
  // local development doesn't need Redis running.
  redisUrl: process.env.REDIS_URL || null,
  // TTL of the assembled portfolio cache in Redis (sec).
  cacheTtlSec: int(process.env.CACHE_TTL_SEC, 60),
  webOrigin: process.env.WEB_ORIGIN || '*',
};
