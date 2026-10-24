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
 * Where the live pool watch listens, as a WebSocket.
 *
 * One name for the endpoint, taken from SOLANA_WS_URL if it is set and
 * otherwise from the first SOLANA_RPC_URL — the same node answers both, and
 * having to set the same host twice is how the two end up pointing at
 * different places. Solana's own public endpoint is the fallback: it carries
 * account subscriptions and is rate-limited enough that a handful of pools is
 * the honest limit of it, which is what a private node is for.
 */
function solanaWsUrl(): string {
  const explicit = (process.env.SOLANA_WS_URL || '').trim();
  if (explicit) return explicit;
  const rpc = (process.env.SOLANA_RPC_URL || '').split(',')[0].trim();
  return rpc.startsWith('http') ? rpc.replace(/^http/, 'ws') : 'wss://api.mainnet-beta.solana.com';
}

/**
 * The gateway's config. Sign-in lives in the auth service and scanning in the
 * scanners it drives itself, so nothing about Telegram belongs here — the api
 * needs to know how to reach the auth service, the broker, its cache and its
 * database.
 */
export const config = {
  port: int(process.env.PORT, 3000),
  // Only verifies tokens — they're issued by the auth service with the same secret
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  // Internal URL of the auth service — the gateway forwards /auth/* to it.
  authServiceUrl: (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, ''),
  earnApiUrl: (process.env.EARN_API_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  // How often a wallet that's in use is rescanned. Used for the "stale" flag
  // (3× this) and reported to the frontend. It used to have to match a second
  // copy of this variable in the wallet service, and reading as stale the
  // moment it was scanned on time is what happened when it did not; the
  // pipeline is in this process now, so there is one value.
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
  // How many cycles in a row must confirm a sharp move before the writer
  // believes it. See the judging in wallet/sync/scan-result-consumer.
  dropConfirmCycles: int(process.env.SYNC_DROP_CONFIRM_CYCLES, 3),
  // How often a TRON wallet's energy/bandwidth/delegations are re-read. Far
  // slower than the balance sync on purpose: one read is four or more
  // SEQUENTIAL rate-limited TronGrid calls, and resources move on the scale of
  // a delegation lock (days), not of a price. In between, the stored snapshot
  // is carried forward untouched.
  tronResourceIntervalMin: int(process.env.TRON_RESOURCE_INTERVAL_MIN, 60),
  // Optional TronGrid API key. Keyless works — the monolith ran that way — but
  // a key is what keeps us off the shared free-tier bucket as Tron wallets grow.
  tronApiKey: process.env.TRON_PRO_API_KEY || null,
  // The broker, for telling the bot a payment landed. Empty — the thank-you
  // message is simply never sent; the payment itself works without it.
  queueUrl: process.env.REDIS_URL ?? '',
  // Public URL of the site: where a checkout returns to, and what the buttons
  // under billing messages open. One name across services — the bot reads the
  // same variable.
  webUrl: (process.env.WEB_URL || 'https://svinooh.com').replace(/\/+$/, ''),
  /**
   * Public URL of THIS api, for the webhook the payment gateway calls back.
   * Empty — no callback is requested with the invoice: fine locally, where the
   * sandbox dashboard can be pointed at a tunnel instead.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL || '').replace(/\/+$/, ''),
  // NOWPayments carries the checkout — the operator's own account, proven in
  // use, forwarding every payment to our wallet. No key — payments are off:
  // the offer endpoints still answer, checkout says so instead of pretending.
  nowpaymentsApiKey: process.env.NOWPAYMENTS_API_KEY || '',
  nowpaymentsIpnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
  nowpaymentsApiUrl: (process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1').replace(
    /\/+$/,
    '',
  ),
  webOrigin: process.env.WEB_ORIGIN || '*',
  // Zerion, for the EVM and SOL transfers behind a portfolio's deposits and
  // withdrawals — the same key scanner-evm reads balances with. Empty — those
  // wallets are reported unread; TRON and BTC need no key.
  zerionApiKey: process.env.ZERION_API_KEY || '',
  // The node the live pool watch subscribes to — see wallet/live
  solanaWsUrl: solanaWsUrl(),
};
