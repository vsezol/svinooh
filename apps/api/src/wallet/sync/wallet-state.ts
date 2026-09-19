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

/**
 * A key that recognises this position on the next scan.
 *
 * `Position.id` cannot do it: every scan deletes the wallet's positions and
 * writes them again, so the ids are new each time and anything comparing them
 * would see a wallet where everything had been closed and reopened.
 *
 * What is stable is what the position is: the protocol, the kind of position,
 * the assets it is made of — and for concentrated liquidity, the band it was
 * opened at. The band matters because one wallet can hold two Uniswap V3
 * positions on the same pair, differing only in their price ranges: without
 * the band in the key they collide, the remembered state is whichever of them
 * was written last, and while one is in range and the other out, every scan
 * reads as a fresh crossing — an "entered range" message every five minutes,
 * and the real exit swallowed. A protocol that renames a position breaks the
 * key, and the position then reads as a new one — which re-baselines quietly
 * rather than announcing a change nobody made; re-ranging a position does the
 * same, which is honest, since it IS a new range.
 */
export function positionKey(position: ScanPosition): string {
  const legs = (position.tokens ?? [])
    .filter((t) => t.role === 'supply' || t.role === 'borrow')
    .map((t) => t.symbol.trim().toUpperCase())
    .sort()
    .join('+');
  const band = position.band ? `${position.band.lower}-${position.band.upper}` : '';
  return [position.platform ?? '?', position.symbol, position.name ?? '', legs, band]
    .map((part) => part.replace(CONTROL, '').trim())
    .join(':');
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
