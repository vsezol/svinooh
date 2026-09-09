'use client';

import { useWallClock } from '../../lib/clock';
import { REPLAY_AT_REST, replayFrame } from '../../lib/yield-replay';

/**
 * A day of USDC lending, replayed — the card beside "it reads the whole chain,
 * not just your wallets".
 *
 * A clock walks from midnight to midnight, four lenders' bars fill in
 * proportion to what they hold, and the fees each one paid tick up beside it.
 * The figures are illustrative rather than measured and the card says nothing
 * about being live for exactly that reason — see lib/yield-replay, which is
 * also the one seam a real yields source would plug into.
 */

/**
 * What the card is a reading of.
 *
 * The count is the design's, and it is the one number here that is a claim
 * rather than an illustration: nothing in this app counts lenders yet. It sits
 * in one place so it can be replaced by a measured figure — or dropped — in
 * one edit.
 */
const HEADING = 'USDC · TOP 2,140 LPs · 24H';

/** The lit head of a bar, fading out before the day ends. */
function Spark({ at, glow }: { at: number; glow: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: -2,
        bottom: -2,
        width: 10,
        left: `calc(${(Math.min(at, 1) * 100).toFixed(1)}% - 5px)`,
        borderRadius: 'var(--r-full)',
        background: 'var(--acc)',
        filter: 'blur(3px)',
        opacity: glow,
        transition: 'opacity .4s ease',
      }}
    />
  );
}

function Bar({ fill, glow }: { fill: number; glow: number }) {
  return (
    <div style={{ position: 'relative', height: 4, borderRadius: 'var(--r-full)', background: 'var(--line2)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(fill * 100).toFixed(1)}%`, background: 'var(--acc)', borderRadius: 'var(--r-full)' }} />
      <Spark at={fill} glow={glow} />
    </div>
  );
}

export function YieldReplay() {
  const clock = useWallClock();
  const frame = replayFrame(clock ?? REPLAY_AT_REST);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surf)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)' }}>
          {HEADING}
        </span>
        <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', fontVariantNumeric: 'tabular-nums' }}>
          {frame.clock}
        </span>
      </div>

      <div style={{ margin: '0 18px 12px' }}>
        <Bar fill={frame.progress} glow={frame.glow} />
      </div>

      {frame.rows.map((row) => (
        <div
          key={row.name}
          style={{
            padding: '13px 18px',
            borderTop: '1px solid var(--line)',
            display: 'grid',
            // The name and its earnings on one line, the bar and the share
            // under them — one row of four things, not two rows of two.
            gridTemplateColumns: 'minmax(0,1fr) auto',
            gap: '4px 14px',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
            <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)', whiteSpace: 'nowrap' }}>{row.name}</span>
            <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
              {row.apy}
            </span>
          </div>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-control)', fontWeight: 'var(--fw-medium)', color: 'var(--up)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          >
            {row.earned}
          </span>
          <Bar fill={row.fill} glow={frame.glow} />
          <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', textAlign: 'right', whiteSpace: 'nowrap' }}>
            {row.share}
          </span>
        </div>
      ))}

      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)' }}>
          FEES ACCRUED
        </span>
        <span className="mono" style={{ fontSize: 'var(--fs-read)', fontWeight: 'var(--fw-medium)', fontVariantNumeric: 'tabular-nums' }}>
          {frame.total}
        </span>
      </div>
    </div>
  );
}
