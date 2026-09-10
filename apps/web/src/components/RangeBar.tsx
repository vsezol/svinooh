import type { PositionBand } from '@svinooh/shared';

/**
 * Where a liquidity position is sitting inside its own range, drawn as a
 * geometric scale — the design file's own words for it, replacing the
 * "strip with a ball".
 *
 *  - The axis is a 1px hairline across the full width.
 *  - The range is a low fill with hairline rules top and bottom and vertical
 *    ticks standing on the bounds themselves.
 *  - The current price is a 2px needle with its price in mono above it.
 *
 * In range there is NO padding: the axis runs exactly from the lower bound to
 * the upper, and the ticks stand at its very ends — empty margins around a
 * scale are what the design review threw out. Room appears only when the price
 * has left the range: the axis extends exactly far enough to bring the needle
 * into frame, the needle stands outside the fill (left of it below the range,
 * right of it above), and the price label pins to that edge.
 *
 * Only the verdict is coloured. In range everything structural takes the up
 * colour; out of range the fill, its rules, the ticks and the needle all turn
 * down. The bound labels are furniture and stay muted either way.
 */
const FILL_ALPHA = 42; // % of tone mixed into the surface — solid, never translucent

/**
 * Only the three prices, not the whole band.
 *
 * A position carries a pair, a fee tier, a network and a price label as well,
 * and this draws none of them — so asking for all of it meant the second place
 * that wanted this scale had to invent four fields it would never read. The
 * type now says what is used.
 */
export type Band = Pick<PositionBand, 'lower' | 'upper' | 'current'>;

export function RangeBar({ band, inRange }: { band: Band; inRange: boolean }) {
  const { lower, upper, current } = band;
  const span = upper - lower;
  // A degenerate band has no inside to be at a point of
  if (!(span > 0)) return null;

  // The axis: the range itself, extended only when the needle stands outside it
  const d0 = Math.min(lower, current);
  const d1 = Math.max(upper, current);
  const x = (price: number) => (price - d0) / (d1 - d0);
  const at = x(current);
  const from = x(lower);
  const to = x(upper);

  const tone = inRange ? 'var(--up)' : 'var(--down)';
  const fill = `color-mix(in srgb, ${tone} ${FILL_ALPHA}%, var(--surf2))`;

  /** Keeps a label (or the needle) on the scale at its ends instead of hanging half off */
  const shift = (p: number) => (p < 0.08 ? '0' : p > 0.92 ? '-100%' : '-50%');

  const label = (p: number, text: string, color?: string) => (
    <span
      className="mono"
      key={text + p}
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

  /** A vertical tick standing on a bound of the range */
  const tick = (p: number) => (
    <span
      key={p}
      style={{
        position: 'absolute',
        left: `${p * 100}%`,
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 1,
        height: 10,
        background: tone,
      }}
    />
  );

  const price = boundFmt(span);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', padding: '2px 16px 10px' }}>
      <div style={{ position: 'relative', height: 13 }}>{label(at, price(current), tone)}</div>

      <div style={{ position: 'relative', height: 14 }}>
        {/* the axis */}
        <span
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: 1,
            transform: 'translateY(-50%)',
            background: 'var(--line2)',
          }}
        />
        {/* the range: a low fill ruled top and bottom */}
        <span
          style={{
            position: 'absolute',
            left: `${from * 100}%`,
            width: `${(to - from) * 100}%`,
            top: '50%',
            height: 8,
            transform: 'translateY(-50%)',
            background: fill,
            borderTop: `1px solid ${tone}`,
            borderBottom: `1px solid ${tone}`,
          }}
        />
        {tick(from)}
        {tick(to)}
        {/* the needle */}
        <span
          style={{
            position: 'absolute',
            left: `${at * 100}%`,
            top: '50%',
            transform: `translate(${shift(at) === '-50%' ? '-50%' : shift(at) === '0' ? '0' : '-100%'}, -50%)`,
            width: 2,
            height: 14,
            background: tone,
          }}
        />
      </div>

      <div style={{ position: 'relative', height: 13, color: 'var(--mut)' }}>
        {label(from, price(lower))}
        {label(to, price(upper))}
      </div>
    </div>
  );
}

/**
 * Priced to the band, not to the dollar: on a stable pair whose whole range is
 * $1.001–$1.003, two-decimal rounding printed the same "$1.00" three times.
 * The precision a bound needs is a function of the span.
 */
function boundFmt(span: number): (v: number) => string {
  const decimals = Math.max(2, Math.min(8, 1 - Math.floor(Math.log10(span))));
  return (v) =>
    '$' + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
