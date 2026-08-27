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
