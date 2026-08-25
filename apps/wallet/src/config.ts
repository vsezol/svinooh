import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bool, int } from '@svinooh/common';

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
  // How many cycles in a row must confirm a sharp drop before we trust it.
  dropConfirmCycles: int(process.env.SYNC_DROP_CONFIRM_CYCLES, 3),
  // Scan queue (RabbitMQ). Empty — the scan runs in-process (local dev).
  rabbitUrl: process.env.RABBITMQ_URL || null,
  scanQueueName: process.env.SCAN_QUEUE_NAME || 'wallet.scan',
  // Pacing: a pause after each scan, to hit 429s less often.
  scanJobDelayMs: int(process.env.SCAN_JOB_DELAY_MS, 1500),
  // How many addresses to work through at once (1 = strictly one at a time).
  scanPrefetch: int(process.env.SCAN_PREFETCH, 1),
  // How often to check that the queue has drained and re-enqueue wallets.
  scanReloadSec: int(process.env.SCAN_RELOAD_SEC, 15),
  httpTimeoutMs: int(process.env.HTTP_TIMEOUT_MS, 15_000),
  evmTimeoutMs: int(process.env.EVM_TIMEOUT_MS, 90_000),
  // Concurrency of the BTC/SOL/TRON HTTP scanners.
  httpConcurrency: int(process.env.SCAN_HTTP_CONCURRENCY, 4),
  // EVM: primary path is HTTP to debank.com, with a headless Chrome fallback.
  evmHttpEnabled: bool(process.env.EVM_HTTP_ENABLED, true),
  evmHttpConcurrency: int(process.env.EVM_HTTP_CONCURRENCY, 3),
  debankProxyUrl: process.env.DEBANK_PROXY_URL || null,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  chromeNoSandbox: bool(process.env.CHROME_NO_SANDBOX, false),
};
