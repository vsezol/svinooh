import type { ScanPosition, WalletPositionState } from '@svinooh/shared';

/**
 * Scam tokens arrive with whatever bytes their deployer chose, and a bytes32
 * symbol decoded off-chain keeps its NUL padding. Postgres text columns refuse
 * NUL outright (22021), and the key is written in one transaction per wallet —
 * so one such token was vetoing the alert state of every position beside it,
 * every scan, forever. Control characters say nothing about which position
 * this is, so the key is the same key without them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function positionKey(position: ScanPosition): string {
  return [
    position.platform ?? '?',
    position.network ?? '',
    position.symbol,
    position.name ?? '',
    ...identityOf(position),
  ]
    .map((part) => part.replace(CONTROL, '').trim())
    .join(':');
}

function identityOf(position: ScanPosition): string[] {
  const ref = position.ref?.trim();
  if (ref) return ['ref', ref];
  const pool = position.pool?.trim();
  if (pool) return ['pool', pool];
  if (position.band) return ['band', `${position.band.lower}-${position.band.upper}`];
  return ['', ''];
}

/**
 * What this position is *within* its protocol — the protocol itself is carried
 * separately, because a message groups by it and would otherwise repeat it on
 * every line.
 *
 * Best answer first. A protocol that answered for the position named the pair
 * and the market itself, and that naming is the one that matches what somebody
 * sees in the protocol's own app. Failing that, a pool of two supplied assets
 * is still a pair and can be written as one. Failing that, the kind of position
 * is all anybody said it was.
 */
function label(position: ScanPosition): string {
  if (position.band) return position.band.pair;
  if (position.loan) return `${position.loan.token} · ${position.loan.market}`;
  const supplied = (position.tokens ?? []).filter((t) => t.role === 'supply');
  if (supplied.length === 2) return `${supplied[0].symbol}/${supplied[1].symbol}`;
  return position.name || position.symbol;
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
  // Keyed rather than listed: everything downstream — the collector's memory,
  // the database row — is keyed by positionKey, so two positions the key
  // cannot tell apart MUST leave here as one state. Left as two, they take
  // turns overwriting each other's memory, and whichever check they disagree
  // on fires again every scan. The merge is pessimistic: one reading out of
  // range makes the pair out of range, the lowest health factor speaks for
  // all of them, the highest borrow rate does — the alert exists to warn, and
  // the twin that is fine is not the one worth reporting.
  const states = new Map<string, WalletPositionState>();
  for (const position of positions) {
    const inRange = position.range == null ? null : position.range === 'in';
    const healthFactor = position.healthRate ?? null;
    // Positions carry the rate as a fraction; thresholds are written in percent
    const borrowApyPct = position.borrowApy == null ? null : position.borrowApy * 100;
    if (inRange === null && healthFactor === null && borrowApyPct === null) continue;

    const key = positionKey(position);
    const twin = states.get(key);
    if (!twin) {
      states.set(key, {
        key,
        platform: position.symbol,
        label: label(position),
        inRange,
        healthFactor,
        borrowApyPct,
        band: position.band ?? null,
        loan: position.loan ?? null,
      });
      continue;
    }
    twin.inRange = twin.inRange === null ? inRange : inRange === null ? twin.inRange : twin.inRange && inRange;
    twin.healthFactor =
      twin.healthFactor === null
        ? healthFactor
        : healthFactor === null
          ? twin.healthFactor
          : Math.min(twin.healthFactor, healthFactor);
    twin.borrowApyPct =
      twin.borrowApyPct === null
        ? borrowApyPct
        : borrowApyPct === null
          ? twin.borrowApyPct
          : Math.max(twin.borrowApyPct, borrowApyPct);
  }
  return [...states.values()];
}
