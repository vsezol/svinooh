import type { AlertItem, TronResources, WalletPositionState } from '@svinooh/shared';

/** What the owner asked to be told about this wallet */
export interface Settings {
  rangeAlerts: boolean;
  healthFactorBelow: number | null;
  borrowApyAbove: number | null;
  tronReclaimAlerts: boolean;
  tronDelegateAlerts: boolean;
}

/** What was last true of a position */
export interface Remembered {
  inRange: boolean | null;
  healthBreached: boolean;
  borrowBreached: boolean;
  reclaimArmed: boolean;
  delegateArmed: boolean;
}

/**
 * The key the Tron row is remembered under.
 *
 * `WalletAlertState` is keyed by position, and a Tron wallet's resources are not
 * a position — but they are exactly the same kind of thing to remember: what was
 * true last time, so a change can be told from a state that simply persists. A
 * reserved key rather than a second table, and one that cannot collide with a
 * real position key (those are built from a platform and a symbol).
 */
export const TRON_STATE_KEY = '\u0000tron:resources';

export interface Decision {
  items: AlertItem[];
  /** What to remember, for every position seen this time */
  next: Map<string, Remembered>;
}

const FRESH: Remembered = {
  inRange: null,
  healthBreached: false,
  borrowBreached: false,
  reclaimArmed: false,
  delegateArmed: false,
};

/**
 * What changed since last time, and what is worth saying about it.
 *
 * A range and a threshold are not the same kind of thing, and they are not
 * treated as one:
 *
 *  - **A range is announced on the crossing, and only on the crossing.** It is
 *    an event: the price left the band, or came back into it. Repeating it
 *    would say nothing new — the position is out of range and earning nothing
 *    until it is not, and its owner already knows because we said so. The first
 *    sighting is silent for the same reason in reverse: a position that is
 *    already out of range when we first look has been for an unknown while, and
 *    that is not this scan's news.
 *
 *  - **A threshold is a condition, and it says so on every check until it
 *    stops.** A health factor under the line is a position walking towards
 *    liquidation and a borrow rate over it is money leaking every hour; both
 *    persist until somebody repays, adds collateral, or decides the threshold
 *    was wrong. So every scan that still finds one says so, carrying the
 *    reading it found — a row of them is the position getting worse or better
 *    in front of you. There is no clock and nothing to remember about when we
 *    last spoke: what is true now is what gets sent.
 *
 *  - **Coming back is worth a message too.** Being told the danger has passed
 *    is half of why anybody turns an alert on, and it is the only thing that
 *    makes the silence in between mean something.
 *
 * A threshold nobody set is nobody watching, so nothing is compared against it
 * — and turning an alert off does not just silence it, it forgets the state, so
 * turning it back on baselines rather than firing about a crossing that
 * happened while nobody was listening.
 */
export function decide(
  positions: WalletPositionState[],
  settings: Settings,
  previous: Map<string, Remembered>,
  tron: TronResources | null = null,
): Decision {
  const items: AlertItem[] = [];
  const next = new Map<string, Remembered>();

  for (const position of positions) {
    const before = previous.get(position.key) ?? FRESH;
    const seen = previous.has(position.key);
    const now: Remembered = { ...FRESH };
    // What every item about this position says about itself, whatever crossed.
    // The reading and the threshold are per-check and go on top.
    //
    // Defaulted rather than trusted: during a deploy the queue still holds
    // states published by a wallet service that predates these fields, and an
    // alert that throws on the way past is an alert nobody gets.
    const about = {
      platform: position.platform ?? '',
      position: position.label,
      band: position.band ?? null,
      loan: position.loan ?? null,
    };

    if (settings.rangeAlerts && position.inRange !== null) {
      now.inRange = position.inRange;
      // Silent on the first sighting: an unknown length of time out of range is
      // not news, and it is not this scan's doing
      if (seen && before.inRange !== null && before.inRange !== position.inRange) {
        items.push({
          ...about,
          kind: 'range',
          direction: position.inRange ? 'recovered' : 'entered',
          value: null,
          threshold: null,
        });
      }
    }

    const health = settings.healthFactorBelow;
    if (health !== null && position.healthFactor !== null) {
      const breached = position.healthFactor < health;
      now.healthBreached = breached;
      // Under the line: said, every time, including the first sighting —
      // somebody who has just asked to be warned about liquidation is owed the
      // warning now. Not under it: said once, on the way back out. Which is why
      // the previous state is remembered at all.
      if (breached || before.healthBreached) {
        items.push({
          ...about,
          kind: 'health',
          direction: breached ? 'entered' : 'recovered',
          value: position.healthFactor,
          threshold: health,
        });
      }
    }

    const borrow = settings.borrowApyAbove;
    if (borrow !== null && position.borrowApyPct !== null) {
      const breached = position.borrowApyPct > borrow;
      now.borrowBreached = breached;
      if (breached || before.borrowBreached) {
        items.push({
          ...about,
          kind: 'borrow',
          direction: breached ? 'entered' : 'recovered',
          value: position.borrowApyPct,
          threshold: borrow,
        });
      }
    }

    next.set(position.key, now);
  }

  if (tron) decideTron(tron, settings, previous, items, next);

  return { items, next };
}

/**
 * Tron's two actions, which are not thresholds and not crossings.
 *
 * `reclaim` and `delegate` say something became POSSIBLE: a delegation came
 * unlocked, or resources fell idle. That makes them **one-way**. Going false
 * again is not news — nothing happened to the wallet, its owner simply did the
 * thing, or spent the bandwidth — and a message saying an action is no longer
 * available would read as a problem where there is none. So unlike a health
 * factor, which is a condition and repeats while it holds, and unlike a range,
 * which is announced in both directions, this fires once on `false → true` and
 * says nothing on the way back.
 *
 * The first sighting is a silent baseline for the same reason it is elsewhere: a
 * delegation that unlocked at some unknown point before we first looked is not
 * this scan's news, and the page already shows the state to anyone who adds the
 * wallet.
 *
 * An alert switched off forgets its state along with silencing it (the flag is
 * written as false), so switching it back on baselines instead of firing about
 * something that happened while nobody was listening.
 */
function decideTron(
  tron: TronResources,
  settings: Settings,
  previous: Map<string, Remembered>,
  items: AlertItem[],
  next: Map<string, Remembered>,
): void {
  const before = previous.get(TRON_STATE_KEY) ?? FRESH;
  const seen = previous.has(TRON_STATE_KEY);
  const flags = computeTronFlags(tron, Date.now());

  const reclaim = settings.tronReclaimAlerts && flags.reclaim;
  const delegate = settings.tronDelegateAlerts && flags.delegate;

  const about = { platform: 'TRON', band: null, loan: null, value: null, threshold: null };
  if (seen && reclaim && !before.reclaimArmed) {
    items.push({
      ...about,
      kind: 'reclaim',
      direction: 'entered',
      position: 'Delegated resources',
      tron,
    });
  }
  if (seen && delegate && !before.delegateArmed) {
    items.push({
      ...about,
      kind: 'delegate',
      direction: 'entered',
      position: 'Idle resources',
      tron,
    });
  }

  next.set(TRON_STATE_KEY, { ...FRESH, reclaimArmed: reclaim, delegateArmed: delegate });
}

/** Enough bandwidth to actually send the transaction the alert is about */
const BANDWIDTH_FOR_TX = 500;

/**
 * What the owner could do right now — the port of `computeTronFlags` from the
 * defi-ltv monolith, and the same numbers.
 *
 * `expireAt` of 0 is a delegation made WITHOUT a lock, not one that expired in
 * 1970: both mean it can be taken back now, which is why they share a branch.
 */
function computeTronFlags(
  resources: TronResources,
  now: number,
): { reclaim: boolean; delegate: boolean } {
  const reclaimableNow = resources.delegations.some((d) => !d.expireAt || d.expireAt <= now);
  return {
    reclaim: reclaimableNow && resources.bandwidthFree > BANDWIDTH_FOR_TX,
    delegate:
      resources.energyFree > 0 &&
      resources.bandwidthFree > BANDWIDTH_FOR_TX &&
      !resources.hasDelegation,
  };
}
