import type { Chain, ScanResult } from '@svinooh/shared';

/**
 * What travels between the service that decides *what* to scan and the services
 * that do the scanning. Both sides compile against this file, so a change that
 * only lands on one of them doesn't compile.
 */

/** Every scan queue starts with this; see hasPriority */
export const SCAN_QUEUE_PREFIX = 'scan.';

/** One queue per chain: scan.evm, scan.sol, scan.tron, scan.btc. */
export function scanQueueName(chain: Chain): string {
  return `${SCAN_QUEUE_PREFIX}${chain.toLowerCase()}`;
}

/**
 * Highest priority a scan queue accepts. Two levels is all this needs: an
 * address nobody has ever scanned goes first, everything else is equal.
 */
export const SCAN_MAX_PRIORITY = 1;

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

/** The scan queues carry a priority; the result queue and the telegram queues do not */
export function hasPriority(queue: string): boolean {
  return queue.startsWith(SCAN_QUEUE_PREFIX) && queue !== SCAN_RESULT_QUEUE;
}

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
   * Nobody has ever read this address: there is no stored value behind it and
   * somebody is watching the spinner it put on their screen.
   *
   * Carried separately from `priority`, which the two happen to agree on today.
   * They are different questions — one is where the job sits in the queue, the
   * other is what may be traded away to answer it sooner — and a source picked
   * off a queue hint would be a surprise the day the hint changes.
   */
  firstScan?: boolean;
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

/** Where the collector puts what somebody should be told. Read by the bot. */
export const ALERTS_QUEUE = 'alerts.telegram';

/**
 * Things to tell somebody that are not about a position crossing a line.
 *
 * A separate queue rather than a second shape on ALERTS_QUEUE, so a bot that
 * predates it is never handed a message it cannot read: during a rollout these
 * simply wait until the bot that understands them is up.
 */
export const NOTICES_QUEUE = 'notices.telegram';

/**
 * Everything money says to a person: the trial running out, Pro about to end or
 * ended, a payment landing. Its own queue for the same reason notices got one —
 * a bot that predates the shape must never be handed it — and because these are
 * the messages that must survive a Telegram outage the longest: a lost alert is
 * a missed reading, a lost renewal reminder is churn.
 */
export const BILLING_QUEUE = 'billing.telegram';
