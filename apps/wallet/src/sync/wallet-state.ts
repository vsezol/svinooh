import type { ScanPosition, WalletPositionState } from '@svinooh/shared';

/**
 * A key that recognises this position on the next scan.
 *
 * `Position.id` cannot do it: every scan deletes the wallet's positions and
 * writes them again, so the ids are new each time and anything comparing them
 * would see a wallet where everything had been closed and reopened.
 *
 * What is stable is what the position is: the protocol, the kind of position,
 * and the assets it is made of. A protocol that renames a position breaks the
 * key, and the position then reads as a new one — which re-baselines quietly
 * rather than announcing a change nobody made.
 */
export function positionKey(position: ScanPosition): string {
  const legs = (position.tokens ?? [])
    .filter((t) => t.role === 'supply' || t.role === 'borrow')
    .map((t) => t.symbol.trim().toUpperCase())
    .sort()
    .join('+');
  return [position.platform ?? '?', position.symbol, position.name ?? '', legs]
    .map((part) => part.trim())
    .join(':');
}

/** What a message about this position should call it */
function label(position: ScanPosition): string {
  return position.name && position.name !== position.symbol
    ? `${position.symbol} · ${position.name}`
    : position.symbol;
}

/**
 * The positions worth telling somebody about, and nothing else.
 *
 * A plain token holding has no band to leave and no loan to go bad; carrying it
 * would make every event as long as the portfolio and give the reader nothing
 * to decide on. What is left is positions with a range, a health factor or a
 * borrow rate — which is exactly the set the alert settings can be about.
 */
export function alertableStates(positions: ScanPosition[]): WalletPositionState[] {
  const states: WalletPositionState[] = [];
  for (const position of positions) {
    const inRange = position.range == null ? null : position.range === 'in';
    const healthFactor = position.healthRate ?? null;
    // Positions carry the rate as a fraction; thresholds are written in percent
    const borrowApyPct = position.borrowApy == null ? null : position.borrowApy * 100;
    if (inRange === null && healthFactor === null && borrowApyPct === null) continue;
    states.push({ key: positionKey(position), label: label(position), inRange, healthFactor, borrowApyPct });
  }
  return states;
}
