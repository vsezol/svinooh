import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  port: int(process.env.PORT, 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  botToken: process.env.TELEGRAM_BOT_TOKEN || null,
  botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
  devMode: bool(process.env.AUTH_DEV_MODE, false),
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
  // Public URL of the web app — for the "back to site" button in the bot.
  webUrl: (process.env.WEB_URL || 'https://svinooh.com').replace(/\/+$/, ''),
  // How many cycles in a row must confirm a sharp drop in a wallet's value
  // before we trust it. One-off dips (a partial source response, a Chrome
  // glitch) thus never make it into the history or draw a "sawtooth".
  dropConfirmCycles: int(process.env.SYNC_DROP_CONFIRM_CYCLES, 3),
  // Scan queue (RabbitMQ) and cache (Redis). Empty — we run without a broker:
  // the scan runs in-process in the same service and the cache becomes
  // in-memory. This way local development doesn't require spinning up
  // Rabbit/Redis.
  rabbitUrl: process.env.RABBITMQ_URL || null,
  redisUrl: process.env.REDIS_URL || null,
  scanQueueName: process.env.SCAN_QUEUE_NAME || 'wallet.scan',
  // Pacing: a pause after each scan — "gently", to hit 429s less often.
  scanJobDelayMs: int(process.env.SCAN_JOB_DELAY_MS, 1500),
  // How many addresses to work through at once. 1 = strictly one at a time
  // (gentlest on rate limits). Can be raised once the HTTP path stops hitting
  // 429s.
  scanPrefetch: int(process.env.SCAN_PREFETCH, 1),
  // How often to check that the queue has drained and re-enqueue wallets.
  scanReloadSec: int(process.env.SCAN_RELOAD_SEC, 15),
  // TTL of the assembled portfolio cache in Redis (sec).
  cacheTtlSec: int(process.env.CACHE_TTL_SEC, 60),
  // Loki for logs. Empty — we send to stdout only (Railway), without Loki.
  lokiUrl: process.env.LOKI_URL || null,
  webOrigin: process.env.WEB_ORIGIN || '*',
  httpTimeoutMs: int(process.env.HTTP_TIMEOUT_MS, 15_000),
  evmTimeoutMs: int(process.env.EVM_TIMEOUT_MS, 90_000),
  // Concurrency of the BTC/SOL/TRON HTTP scanners.
  httpConcurrency: int(process.env.SCAN_HTTP_CONCURRENCY, 4),
  // EVM: the primary path is HTTP to debank.com (reverse-engineered signing),
  // with a fallback to headless Chrome on failure. The Chrome part is serialized
  // by a dedicated lock (never 2 instances at once), so HTTP can be run with a
  // pool.
  evmHttpEnabled: bool(process.env.EVM_HTTP_ENABLED, true),
  evmHttpConcurrency: int(process.env.EVM_HTTP_CONCURRENCY, 3),
  // Optional proxy for debank.com — in case Cloudflare starts blocking the
  // datacenter IP (Railway). Empty — a direct connection.
  debankProxyUrl: process.env.DEBANK_PROXY_URL || null,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  chromeNoSandbox: bool(process.env.CHROME_NO_SANDBOX, false),
};
