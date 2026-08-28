import type { AlertItem, WalletPositionState } from '@svinooh/shared';

/** What the owner asked to be told about this wallet */
export interface Settings {
  rangeAlerts: boolean;
  healthFactorBelow: number | null;
  borrowApyAbove: number | null;
}

/** What was last true of a position, and when we last said so */
export interface Remembered {
  inRange: boolean | null;
  healthBreached: boolean;
  borrowBreached: boolean;
  /** When the owner was last told the health factor was under the line — null: nothing outstanding */
  healthNotifiedAt: Date | null;
  /** The same clock for the borrow rate */
  borrowNotifiedAt: Date | null;
}

export interface Decision {
  items: AlertItem[];
  /** What to remember, for every position seen this time */
  next: Map<string, Remembered>;
}

const FRESH: Remembered = {
  inRange: null,
  healthBreached: false,
  borrowBreached: false,
  healthNotifiedAt: null,
  borrowNotifiedAt: null,
};

/**
 * How long a standing breach keeps quiet before it says so again.
 *
 * A wallet is scanned every few minutes, so repeating on every scan would be
 * twelve messages an hour and the first thing anybody would do is mute the bot
 * — which is the one outcome that makes the alert worse than nothing. An hour
 * is often enough that a health factor sliding towards liquidation cannot be
 * missed, and rare enough to still read as a warning rather than as noise.
 */
const REPEAT_MS = 60 * 60 * 1000;

/** A breach that has gone unmentioned long enough to mention again */
function due(last: Date | null, at: Date): boolean {
  return last === null || at.getTime() - last.getTime() >= REPEAT_MS;
}

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
 *  - **A threshold is a condition, and it keeps saying so until it stops.** A
 *    health factor under the line is a position walking towards liquidation and
 *    a borrow rate over it is money leaking every hour; both persist until
 *    somebody repays, adds collateral, or decides the threshold was wrong. So
 *    they are raised on the crossing — including on the first sighting, when
 *    somebody who has just asked to be warned is owed the warning now — and
 *    then again every REPEAT_MS for as long as they stand. The repeat carries
 *    the current reading, so a row of them shows which way it is going.
 *
 *  - **Coming back is worth a message too.** Being told the danger has passed
 *    is half of why anybody turns an alert on, and it is the only thing that
 *    makes the silence in between mean something.
 *
 * A threshold nobody set is nobody watching, so nothing is compared against it
 * — and turning an alert off does not just silence it, it forgets the state and
 * the clock, so turning it back on baselines rather than firing about a
 * crossing that happened while nobody was listening.
 */
export function decide(
  positions: WalletPositionState[],
  settings: Settings,
  previous: Map<string, Remembered>,
  at: Date,
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
      // The clock carries forward untouched unless something is said: reset it
      // on every scan and the repeat would never come round
      now.healthNotifiedAt = breached ? before.healthNotifiedAt : null;
      // A first sighting remembers "not breached", so a position already under
      // the line differs from it and speaks at once
      const crossed = breached !== before.healthBreached;
      if (crossed || (breached && due(before.healthNotifiedAt, at))) {
        items.push({
          ...about,
          kind: 'health',
          direction: !breached ? 'recovered' : crossed ? 'entered' : 'still',
          value: position.healthFactor,
          threshold: health,
        });
        now.healthNotifiedAt = breached ? at : null;
      }
    }

    const borrow = settings.borrowApyAbove;
    if (borrow !== null && position.borrowApyPct !== null) {
      const breached = position.borrowApyPct > borrow;
      now.borrowBreached = breached;
      now.borrowNotifiedAt = breached ? before.borrowNotifiedAt : null;
      const crossed = breached !== before.borrowBreached;
      if (crossed || (breached && due(before.borrowNotifiedAt, at))) {
        items.push({
          ...about,
          kind: 'borrow',
          direction: !breached ? 'recovered' : crossed ? 'entered' : 'still',
          value: position.borrowApyPct,
          threshold: borrow,
        });
        now.borrowNotifiedAt = breached ? at : null;
      }
    }

    next.set(position.key, now);
  }

  return { items, next };
}
