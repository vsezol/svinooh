import type { AlertItem, WalletPositionState } from '@svinooh/shared';

/** What the owner asked to be told about this wallet */
export interface Settings {
  rangeAlerts: boolean;
  healthFactorBelow: number | null;
  borrowApyAbove: number | null;
}

/** What was last true of a position */
export interface Remembered {
  inRange: boolean | null;
  healthBreached: boolean;
  borrowBreached: boolean;
}

export interface Decision {
  items: AlertItem[];
  /** What to remember, for every position seen this time */
  next: Map<string, Remembered>;
}

const FRESH: Remembered = { inRange: null, healthBreached: false, borrowBreached: false };

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

  return { items, next };
}
