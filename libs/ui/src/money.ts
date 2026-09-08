/**
 * How this product writes money.
 *
 * In the kit because two surfaces draw the same figures now — the portfolio's
 * charts and the ones the assistant puts in a chat — and a dollar written two
 * ways in one product is a dollar somebody has to stop and compare.
 *
 * The app keeps importing these from its own lib, which re-exports; nothing had
 * to move at eleven call sites for one chart to share a formatter.
 */

/** The full figure, two decimals by default. A dash for nothing at all. */
export function fmtUsd(value: number | null | undefined, dec = 2): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return (
    sign +
    '$' +
    Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  );
}

/** Rounded to the dollar — a total, where the cents are noise. */
export function fmtUsdShort(value: number): string {
  return (value < 0 ? '-$' : '$') + Math.round(Math.abs(value)).toLocaleString('en-US');
}
