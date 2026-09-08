/**
 * When a reading is worth doubting, and when two readings count as the same
 * answer.
 *
 * In libs/common because BOTH ends of the pipeline have to agree on it: the
 * scanners decide from this whether to spend a second look, and the writer
 * decides from it whether it has been given one worth having. Two copies of
 * these numbers is two copies that drift, and the direction they drift in is a
 * reading nobody re-read and nobody doubted.
 *
 * Its own file because it is the whole of the arbitration and it is worth
 * testing on its own — the consumers around it need a database, a queue and a
 * wallet row to say anything at all, and none of that is what goes wrong.
 */

/**
 * How far a reading may sit from the last stored one before it has to be
 * corroborated. A quarter, in EITHER direction.
 *
 * The fall side is the old drop-confirmation threshold and is unchanged. The
 * rise side did not exist: the rule read "normal, or up", so any increase was
 * believed on sight. That is how a $7 address came to be stored at $827, then
 * $449,833, then $1,166,714 inside half an hour on 2026-09-08 — three balances
 * belonging to somebody else, each one waved through for pointing upwards.
 */
const BAND = 0.25;

/**
 * Below this, a wallet's swings are not information.
 *
 * Dust moves by whole percentages when a single token reprices, and holding a
 * $2 wallet for confirmation every cycle would spend the arbitration on the
 * addresses where being wrong costs nothing. A move has to clear the band AND
 * this before anybody argues about it.
 */
const FLOOR_USD = 25;

/** Has this reading left the neighbourhood of the last stored one? */
export function moved(previous: number, next: number): boolean {
  const gap = Math.abs(next - previous);
  if (gap < FLOOR_USD) return false;
  // A previous of zero has no neighbourhood to leave: any real money arriving
  // is a move, and the ratio below cannot be formed
  if (previous <= 0) return true;
  return gap / previous > BAND;
}

/**
 * Do two readings of the same address, taken seconds apart, say the same thing?
 *
 * The absolute floor matters as much as the ratio here. A $7 wallet re-read at
 * $4 is 43% apart and is plainly the same answer — both say "there is nothing
 * here" — and calling that a disagreement is what would keep a dust wallet from
 * ever settling.
 */
export function agree(a: number, b: number): boolean {
  const gap = Math.abs(a - b);
  if (gap < FLOOR_USD) return true;
  const larger = Math.max(Math.abs(a), Math.abs(b));
  return larger > 0 && gap / larger <= BAND;
}

/**
 * Whether a reading is far enough from the stored one for a scanner to spend a
 * second look on it.
 *
 * The same test as `moved`, and deliberately so: a move the writer will refuse
 * to store without corroboration is exactly the move worth corroborating while
 * the browser is still open and the page still warm. When these were allowed to
 * differ, the gap between them was a move that arrived with nothing to check it
 * against — and the writer, having nothing, believed it.
 */
export function worthRereading(previous: number | null, next: number): boolean {
  return previous !== null && moved(previous, next);
}
