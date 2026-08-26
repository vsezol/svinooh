/**
 * We are deliberately not applying a scan result — the source did not fail us,
 * we chose to hold. Two cases: a drop we don't believe yet, and a backoff after
 * the upstream started throttling.
 *
 * The distinction matters to the person looking at the page. A hold means their
 * last known value is still good and simply wasn't refreshed this cycle, so the
 * wallet must NOT be marked `failed` — telling someone their sync broke when we
 * chose to skip it is both wrong and alarming.
 */
export class ScanHold extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanHold';
  }
}
