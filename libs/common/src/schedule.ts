import { setting } from './settings';

/** What a portfolio holding this address knows about being looked at */
export interface Holder {
  /** When somebody last opened it, or null if nobody ever has */
  lastViewedAt: Date | null;
}

/** How soon a dispatched job wants to be taken */
export type ScanPriority = 'urgent' | 'normal';

export interface Schedule {
  nextScanAt: Date;
  priority: ScanPriority;
}

/**
 * How often an address is worth scanning, and how badly it wants it now.
 *
 * One rule, and it is the whole rule: **somebody is looking → scan often;
 * nobody is → scan rarely.** It does not matter who owns the portfolio or
 * whether anybody does. An anonymous portfolio people keep opening earns fresh
 * data exactly as much as a signed-in one, and a signed-in portfolio nobody has
 * opened in a month earns it exactly as little.
 *
 * That used to be three conditions with an ownership join behind them, and the
 * ownership half was doing no work anybody could describe: it kept scanning at
 * full rate for accounts that had stopped visiting, which is the case that
 * costs the most and is worth the least.
 *
 * A brand-new address is the one exception, and it is about the first minute of
 * somebody's experience rather than about cost: they pasted an address and are
 * watching a spinner, so it goes to the front of the queue and is scanned at
 * once. After that it joins everybody else.
 *
 * The clock is passed in rather than read, so this can be reasoned about and
 * tested without one.
 */
export function schedule(
  holders: Holder[],
  lastSyncedAt: Date | null,
  now: Date,
): Schedule {
  if (lastSyncedAt === null) {
    return { nextScanAt: now, priority: 'urgent' };
  }

  const staleAfterMs = setting('sync.staleAfterMin') * 60_000;
  // The most recent visit across every portfolio holding it: an address one
  // person still watches is fresh for everybody who holds it, and working out
  // whose visit it was would cost a scan to save nothing
  const inUse = holders.some(
    (h) => h.lastViewedAt !== null && now.getTime() - h.lastViewedAt.getTime() <= staleAfterMs,
  );
  const minutes = inUse ? setting('sync.activeIntervalMin') : setting('sync.staleIntervalMin');
  return { nextScanAt: new Date(now.getTime() + minutes * 60_000), priority: 'normal' };
}

/** Whether a portfolio counts as in use right now — the same line, asked directly */
export function inUse(lastViewedAt: Date | null, now: Date): boolean {
  if (lastViewedAt === null) return false;
  return now.getTime() - lastViewedAt.getTime() <= setting('sync.staleAfterMin') * 60_000;
}

/**
 * How long a dispatched scan holds its address before anybody may take it
 * again. Long enough for the slowest scan and its queue wait; short enough that
 * a scanner dying does not park an address for an afternoon.
 */
export function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + setting('scan.leaseMin') * 60_000);
}

/**
 * When to try again after a failure.
 *
 * A failed scan used to become due again immediately, so a source that was
 * down got asked about the same address every fifteen seconds — which is how
 * you turn somebody else's outage into your own rate limit.
 */
export function retryAt(now: Date): Date {
  return new Date(now.getTime() + setting('scan.retryMin') * 60_000);
}

/**
 * How many jobs to keep in a chain's queue.
 *
 * Derived rather than configured, because the two numbers it sits between are
 * not independent: a job must not wait in the queue longer than the lease
 * holding its address, or the producer decides the scan was lost and dispatches
 * it a second time. So the depth is however many worst-case jobs fit inside one
 * lease — times the prefetch, since that many are in flight at once.
 *
 * This was a knob, briefly, with a flat default of 20. At an EVM timeout of
 * 150s that is a fifty-minute drain against a ten-minute lease: everything past
 * the third job would have been scanned twice. A number nobody can set wrong is
 * better than a number with a warning next to it.
 */
export function queueDepth(chain: string): number {
  const worstMs =
    (chain === 'EVM' ? setting('scan.evmTimeoutMs') : setting('scan.httpTimeoutMs')) +
    setting('scan.jobDelayMs');
  const perSlot = Math.floor((setting('scan.leaseMin') * 60_000) / worstMs);
  return Math.max(1, perSlot * setting('scan.prefetch'));
}
