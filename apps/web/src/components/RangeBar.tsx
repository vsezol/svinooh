import type { PositionBand } from '@svinooh/shared';
import { Meter } from '../ui';
import { fmtPrice } from '../lib/format';

/**
 * Where a liquidity position is sitting inside its own range.
 *
 * "IN RANGE" is a yes or a no, and the answer an LP actually needs is neither:
 * a position halfway between its bounds and one a hair from the upper edge are
 * both "in range", and only one of them is about to stop earning. The bar is
 * that missing dimension — the bounds at the ends, the price as a mark along
 * it, and the distance between them readable at a glance rather than computed
 * from three numbers.
 *
 * Out of range the mark is pinned to the edge it left, in the down colour. It
 * could be drawn beyond the end instead, honestly showing how far past it has
 * gone — but the price can be multiples away, and a bar that has to hold a
 * price 5× the upper bound is a bar where the range itself is a sliver. Pinned,
 * the range stays legible and the colour says the rest.
 */
export function RangeBar({ band, inRange }: { band: PositionBand; inRange: boolean }) {
  const { lower, upper, current } = band;
  const span = upper - lower;
  // A degenerate band has no inside to be at a point of. Nothing sensible to
  // draw, and a full-width bar with a mark at one end would be a lie.
  if (!(span > 0)) return null;

  const at = Math.min(Math.max((current - lower) / span, 0), 1);
  const tone = inRange ? 'var(--up)' : 'var(--down)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', padding: '2px 16px 10px' }}>
      {/* The price rides ABOVE the bar, over its own mark. Put in a row of its
          own rather than between the two bounds: down there it would read as
          the middle of the range, and on a position that has left its band it
          would sit on top of the bound it left. */}
      <div style={{ position: 'relative', height: 13 }}>
        <span
          className="mono"
          style={{
            position: 'absolute',
            left: `${at * 100}%`,
            // Centred over the mark, except near the ends, where centring would
            // hang the label off the bar. There it lines up with the end it is
            // nearest — which is also where a pinned mark always sits.
            transform: `translateX(${at < 0.12 ? '0' : at > 0.88 ? '-100%' : '-50%'})`,
            fontSize: 'var(--fs-micro)',
            color: tone,
            whiteSpace: 'nowrap',
          }}
        >
          {fmtPrice(current)}
        </span>
      </div>

      {/* A band rather than a quantity: the whole track is the range, and the
          mark is the only number being read off it. */}
      <Meter tone={tone} soft mark={at} markTitle={`${fmtPrice(current)} — ${band.priceLabel}`} />

      <div
        className="mono"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--sp-4)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--mut)',
        }}
      >
        <span>{fmtPrice(lower)}</span>
        <span>{fmtPrice(upper)}</span>
      </div>
    </div>
  );
}
