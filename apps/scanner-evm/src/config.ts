import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bool, int, queueConfigFromEnv } from '@svinooh/common';

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
  // The queue it drains: QUEUE_DRIVER with REDIS_URL or RABBITMQ_URL
  queue: queueConfigFromEnv(),
  // Pause after each scan. The pacing knob against DeBank: this service holds
  // the slot for the whole pause, so the queue does not hand it another
  // address until the pause is over.
  scanJobDelayMs: int(process.env.SCAN_JOB_DELAY_MS, 1500),
  // Zerion API key, for the `zerion` EVM source. A secret, so it lives here and
  // not in the settings registry — that file is public and the admin panel
  // shows every value in it.
  zerionApiKey: process.env.ZERION_API_KEY ?? '',
  zerionTimeoutMs: int(process.env.ZERION_TIMEOUT_MS, 20000),
  // A browser scan is slow by nature — page load, chains resolving one by one
  evmTimeoutMs: int(process.env.EVM_TIMEOUT_MS, 150_000),
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  // Which engine drives the browser scan. 'lightpanda' is the light Zig headless
  // browser (CDP over WebSocket, ~2.5-3x less RAM than Chrome on our workload);
  // 'chrome' is puppeteer-launched Chromium. Anything but 'chrome' means
  // lightpanda — it is the default while we soak it. Both speak CDP, so the scan
  // code below is engine-agnostic.
  scannerEngine: process.env.SCANNER_ENGINE === 'chrome' ? ('chrome' as const) : ('lightpanda' as const),
  // Where the lightpanda binary is. Empty => look next to the service, then PATH.
  lightpandaPath: process.env.LIGHTPANDA_PATH || null,
  lightpandaHost: process.env.LIGHTPANDA_HOST || '127.0.0.1',
  // 0 => the OS picks a free port and we read it back from lightpanda's output.
  // This is deliberate: a fixed port collides with a server leaked by a crashed
  // predecessor, and we'd silently connect to one we can't manage. Set a
  // non-zero LIGHTPANDA_PORT only if you need a known port.
  lightpandaPort: int(process.env.LIGHTPANDA_PORT, 0),
  // Chromium in a container has no user namespaces to sandbox with
  chromeNoSandbox: bool(process.env.CHROME_NO_SANDBOX, false),
};
