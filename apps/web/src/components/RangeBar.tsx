import type { PositionBand } from '@svinooh/shared';
import { Meter } from '../ui';

/**
 * Where a liquidity position is sitting inside its own range.
 *
 * "IN RANGE" is a yes or a no, and the answer an LP actually needs is neither:
 * a position halfway between its bounds and one a hair from the upper edge are
 * both "in range", and only one of them is about to stop earning. The bar is
 * that missing dimension.
 *
 * It is drawn as an instrument, not a control. The band is a segment on a
 * longer axis — a track tinted edge to edge is the visual language of a slider
 * at maximum, and the first version read as exactly that. The axis runs 15% of
 * the span past each bound, which is also what lets a price that has just left
 * the range be SHOWN just outside it: the old bar pinned the mark to the edge,
 * so "barely out" and "long gone" were the same picture. A price further out
 * than the axis reaches still clamps to its end, and the colour carries the
 * rest — an axis that had to hold a price at 5× the upper bound would crush
 * the range itself into a sliver.
 *
 * The bounds sit under their own edges of the band, not at the corners of the
 * card; the current price rides above the tick that marks it. Only the verdict
 * is coloured — the bounds are furniture and stay muted.
 */
const PAD = 0.15;

/**
 * Priced to the band, not to the dollar. fmtPrice rounds anything over a cent
 * to two decimals, and on a stable pair whose whole range is $1.001–$1.003
 * that printed the same "$1.00" three times — a bar between two identical
 * numbers. The precision a bound needs is a function of how wide the band is,
 * so it is read off the span.
 */
function boundFmt(span: number): (v: number) => string {
  const decimals = Math.max(2, Math.min(8, 1 - Math.floor(Math.log10(span))));
  return (v) =>
    '$' + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function RangeBar({ band, inRange }: { band: PositionBand; inRange: boolean }) {
  const { lower, upper, current } = band;
  const span = upper - lower;
  // A degenerate band has no inside to be at a point of. Nothing sensible to
  // draw, and a full-width band with a tick at one end would be a lie.
  if (!(span > 0)) return null;

  /** Price → position on the padded axis, clamped to its ends */
  const x = (price: number) =>
    Math.min(Math.max((price - lower + span * PAD) / (span * (1 + 2 * PAD)), 0), 1);
  const at = x(current);
  const tone = inRange ? 'var(--up)' : 'var(--down)';
  const price = boundFmt(span);

  /** Centred on its point, except near the ends, where centring would hang the label off the bar */
  const shift = (p: number) => (p < 0.1 ? '0' : p > 0.9 ? '-100%' : '-50%');
  const label = (p: number, text: string, color?: string) => (
    <span
      className="mono"
      style={{
        position: 'absolute',
        left: `${p * 100}%`,
        transform: `translateX(${shift(p)})`,
        fontSize: 'var(--fs-micro)',
        letterSpacing: 'var(--tr-tag)',
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', padding: '2px 16px 10px' }}>
      {/* The price rides ABOVE the axis, over its own tick — put between the
          bounds it would read as the middle of the range, and on a position
          that has left its band it would sit on top of the bound it left */}
      <div style={{ position: 'relative', height: 13 }}>{label(at, price(current), tone)}</div>

      <Meter tone={tone} band={{ from: x(lower), to: x(upper) }} mark={at} />

      <div style={{ position: 'relative', height: 13, color: 'var(--mut)' }}>
        {label(x(lower), price(lower))}
        {label(x(upper), price(upper))}
      </div>
    </div>
  );
}
