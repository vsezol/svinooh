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
  adminServiceUrl: (process.env.ADMIN_SERVICE_URL || 'http://localhost:3005').replace(/\/+$/, ''),
  /**
   * Shared with the admin service, and the reason a request that did not come
   * through this gateway gets nowhere. Unset, the admin routes answer NotFound
   * — the same as they do for everybody who is not an admin.
   */
  internalSecret: process.env.INTERNAL_SECRET ?? '',
  earnApiUrl: (process.env.EARN_API_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  // Internal URL of the wallet service — scan-on-add is delegated to it.
  walletServiceUrl: (process.env.WALLET_SERVICE_URL || 'http://localhost:3002').replace(/\/+$/, ''),
  // How often the wallet service rescans a wallet that's in use. Used for the
  // "stale" flag (3× this) and reported to the frontend, so it MUST match the
  // wallet service's SYNC_INTERVAL_MIN — set it lower and every wallet reads as
  // stale the moment it is scanned on time.
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
  // The broker, for telling the bot a payment landed. Empty — the thank-you
  // message is simply never sent; the payment itself works without it.
  rabbitUrl: process.env.RABBITMQ_URL ?? '',
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
};
