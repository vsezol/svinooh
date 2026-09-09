/**
 * A dollar figure short enough to sit in a chart's margin: $134.8k, $1.2M.
 *
 * Not the kit's fmtUsd or fmtUsdShort — both write the number out in full,
 * which is right beside a heading and wrong down the side of a 170px card,
 * where $131,902 is wider than the space the design leaves for it.
 */
export function fmtUsdCompact(value: number): string {
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sign}$${(n / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(n)}`;
}
