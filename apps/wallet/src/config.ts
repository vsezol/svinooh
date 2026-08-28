import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { int } from '@svinooh/common';

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
  // How often a wallet somebody actually uses gets rescanned. This is the real
  // pacing knob: the queue only takes addresses that are due, so the cadence is
  // no longer "as fast as the scans happen to complete".
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
  // The slow tier — wallets that only live in anonymous portfolios nobody has
  // opened lately. Still refreshed, just not on anyone's behalf.
  syncIdleIntervalMin: int(process.env.SYNC_IDLE_INTERVAL_MIN, 30),
  // How recently a portfolio must have been opened to count as "in use". Long
  // enough that a tab left open keeps its wallets on the fast tier.
  syncActiveWindowMin: int(process.env.SYNC_ACTIVE_WINDOW_MIN, 15),
  // How many cycles in a row must confirm a sharp drop before we trust it.
  dropConfirmCycles: int(process.env.SYNC_DROP_CONFIRM_CYCLES, 3),
  // Scan queue (RabbitMQ). Empty — the scan runs in-process (local dev).
  rabbitUrl: process.env.RABBITMQ_URL || null,
  // Pacing: a pause after each scan, to hit 429s less often.
  scanJobDelayMs: int(process.env.SCAN_JOB_DELAY_MS, 1500),
  // How many addresses to work through at once (1 = strictly one at a time).
  scanPrefetch: int(process.env.SCAN_PREFETCH, 1),
  // How often to check that the queue has drained and re-enqueue wallets.
  scanReloadSec: int(process.env.SCAN_RELOAD_SEC, 15),
  // How long a scan claim (Wallet.scanQueuedAt) is believed before the address
  // counts as free again.
  // It has to outlast the slowest scan that can still come back: an EVM one runs
  // to EVM_TIMEOUT_MS (150s) and runs TWICE when it re-reads a suspicious drop,
  // plus the pause after it. Under that and we would re-enqueue an address that
  // is still being scanned, which is the whole thing the lease exists to stop.
  // Over it only costs a genuinely lost job a longer wait.
  scanClaimTtlMin: int(process.env.SCAN_CLAIM_TTL_MIN, 10),
  // When a wallet that has never been scanned stops being "on its way" and
  // starts being broken: no claim is outstanding for its address and it has been
  // pending this long. Deliberately well past one claim TTL — a wallet waiting
  // its turn in a long queue is not a failed one, and saying so would be worse
  // than the spinner it replaces.
  scanStuckPendingMin: int(process.env.SCAN_STUCK_PENDING_MIN, 15),
  httpTimeoutMs: int(process.env.HTTP_TIMEOUT_MS, 15_000),
  // Concurrency of the BTC/SOL/TRON HTTP scanners.
  httpConcurrency: int(process.env.SCAN_HTTP_CONCURRENCY, 4),
};
