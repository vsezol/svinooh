import type { Chain, ScanResult } from '@svinooh/shared';

/**
 * What travels between the service that decides *what* to scan and the services
 * that do the scanning. Both sides compile against this file, so a change that
 * only lands on one of them doesn't compile.
 */

/** One queue per chain: scan.evm, scan.sol, scan.tron, scan.btc */
export function scanQueueName(chain: Chain): string {
  return `scan.${chain.toLowerCase()}`;
}

/**
 * One queue for every result, not one per chain.
 *
 * Scanning costs wildly different amounts per chain — a browser versus a single
 * request — which is why those queues are split. Applying a result is the same
 * few updates and a snapshot whatever chain it came from, and it is done by one
 * consumer so that exactly one thing writes wallet values. There is nothing
 * here to separate.
 */
export const SCAN_RESULT_QUEUE = 'scan.result';

export interface ScanJob {
  chain: Chain;
  address: string;
  /**
   * What these wallets were worth when the job was dispatched.
   *
   * It rides along so the scanner can re-check a suspicious drop itself, while
   * it still has the browser open and the page warm — the one place where a
   * second reading is nearly free. The decision about whether to believe the
   * drop is not made there; see ScanOutcome.recheck.
   */
  previousTotal: number | null;
  /**
   * `urgent` is an address nobody has scanned yet: somebody pasted it a moment
   * ago and is watching a spinner, so it goes to the front of its queue.
   */
  priority?: 'urgent' | 'normal';
  /**
   * TRON only: when this address's resources were last read, as an ISO string,
   * or null if never.
   *
   * It rides along for the same reason previousTotal does — the scanner has no
   * database, and this is the one thing it cannot work out for itself. Reading
   * resources costs four or more sequential rate-limited calls, so a scan only
   * pays for them when the stored snapshot has gone stale; the rest of the time
   * it leaves what is there alone.
   */
  tronResourcesAt?: string | null;
}

export type ScanOutcome =
  | {
      chain: Chain;
      address: string;
      ok: true;
      result: ScanResult;
      /**
       * A second reading, present only when the first came in more than 25%
       * below `previousTotal`. Two readings let the consumer tell a real
       * withdrawal from a source having a bad minute — it is the same evidence
       * the scanner used to gather for itself when it lived in-process.
       */
      recheck: ScanResult | null;
    }
  | { chain: Chain; address: string; ok: false; error: string };

/**
 * Where a scan announces what it found, for whoever decides who should hear
 * about it. Separate from the scan-result queue on purpose: that one is how a
 * scanner hands work back to the wallet service, and this one is what the wallet
 * service says once the work is done and written.
 */
export const WALLET_STATE_QUEUE = 'wallet.state';

/** Where the collector puts what somebody should be told. Read by the bot. */
export const ALERTS_QUEUE = 'alerts.telegram';
