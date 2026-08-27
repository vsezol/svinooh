import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bool, int } from '@svinooh/common';

// .env lives at the root of apps/scanner-evm. At runtime __dirname is
// apps/scanner-evm/dist (after nest build) or apps/scanner-evm/src (under tsx) —
// in both cases ../.env is correct. Real environment variables take priority.
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // no permissions or a corrupt file — we run with whatever is in the environment
  }
}

/**
 * Everything this service needs, and nothing else. It has no database, no
 * queue and no idea what a portfolio is: it is handed an address and returns
 * what that address holds.
 */
export const config = {
  port: int(process.env.PORT, 3000),
  // Shared with the wallet service, which calls in: the same string in both.
  internalToken: process.env.INTERNAL_TOKEN || null,
  httpTimeoutMs: int(process.env.HTTP_TIMEOUT_MS, 15_000),
  // A browser scan is slow by nature — page load, chains resolving one by one
  evmTimeoutMs: int(process.env.EVM_TIMEOUT_MS, 150_000),
  evmHttpConcurrency: int(process.env.EVM_HTTP_CONCURRENCY, 3),
  // Primary path is a signed HTTP call to debank.com; the browser is the fallback
  evmHttpEnabled: bool(process.env.EVM_HTTP_ENABLED, true),
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  debankProxyUrl: process.env.DEBANK_PROXY_URL || null,
  // Chromium in a container has no user namespaces to sandbox with
  chromeNoSandbox: bool(process.env.CHROME_NO_SANDBOX, false),
};
