import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bool, int } from '@svinooh/common';

// .env lives at the root of apps/auth. At runtime __dirname is apps/auth/dist
// (after nest build) or apps/auth/src (under tsx) — in both cases ../.env is
// correct. Real environment variables take priority over the file.
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // no permissions or a corrupt file — we run with whatever is in the environment
  }
}

process.env.DATABASE_URL ??= 'postgresql://svinooh:svinooh@localhost:5432/svinooh';

export const config = {
  port: int(process.env.PORT, 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  botToken: process.env.TELEGRAM_BOT_TOKEN || null,
  botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
  // OAuth 2.0 app credentials from the X developer portal. Both unset simply
  // means the X button stays "soon" — nothing else changes.
  xClientId: process.env.X_CLIENT_ID || null,
  xClientSecret: process.env.X_CLIENT_SECRET || null,
  devMode: bool(process.env.AUTH_DEV_MODE, false),
  // Public URL of the web app — for the "back to site" button in the bot.
  webUrl: (process.env.WEB_URL || 'https://svinooh.com').replace(/\/+$/, ''),
  // Shared with the bot, which is the only thing allowed to ask for a sign-in
  // link on somebody's behalf. Unset means the internal route refuses
  // everything rather than standing open.
  internalSecret: process.env.INTERNAL_SECRET || null,
  // Reported in /auth/config; the gateway overrides it with its own value.
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
};
