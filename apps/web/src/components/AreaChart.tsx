import { useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { HistoryRange } from '@svinooh/shared';
import { fmtUsd, fmtUsd0 } from '../lib/format';

interface Props {
  values: number[];
  times: number[]; // ms, same length
  period: HistoryRange;
  height: string;
  variant?: 'full' | 'mini';
}

const mono = "'IBM Plex Mono',monospace";

function dateLabel(ms: number, period: HistoryRange): string {
  const d = new Date(ms);
  if (period === '24h') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Custom SVG chart: area + line + grid + hover cursor. Pixel-for-pixel from the design. */
export function AreaChart({ values, times, period, height, variant = 'full' }: Props) {
  const gradId = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    const N = values.length;
    if (N < 2) return null;
    let mn = Math.min(...values);
    let mx = Math.max(...values);
    const padR = (mx - mn) * 0.1 || mx * 0.05 || 1;
    mn -= padR;
    mx += padR;
    const X = (i: number) => (i / (N - 1)) * 1000;
    const Y = (v: number) => 232 - ((v - mn) / (mx - mn)) * 224;
    const linePath = values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
    const areaPath = linePath + ' L1000,240 L0,240 Z';
    return { N, mn, mx, X, Y, linePath, areaPath };
  }, [values]);

  if (!geom) {
    // mini variant (demo card) — just empty space, no text
    if (variant === 'mini') return <div style={{ height }} />;
    return (
      <div
        className="card"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 30px',
          fontFamily: mono,
          fontSize: 12,
          color: 'var(--mut)',
        }}
      >
        History shows up after a couple of syncs — wallets refresh every 5 minutes.
      </div>
    );
  }

  const { N, mn, mx, Y, linePath, areaPath } = geom;

  const isMini = variant === 'mini';
  const hoverIdx = hover != null ? Math.round(hover * (N - 1)) : null;
  const hPct = hoverIdx != null ? (hoverIdx / (N - 1)) * 100 : 0;
  const yPct = hoverIdx != null ? (Y(values[hoverIdx]) / 240) * 100 : 0;

  const box: CSSProperties = {
    position: 'relative',
    border: isMini ? 'none' : '1px solid var(--line)',
    borderRadius: isMini ? 0 : 16,
    background: isMini ? 'transparent' : 'var(--surf)',
    overflow: 'hidden',
  };

  const tipLeft = hPct < 55 ? `calc(${hPct}% + 10px)` : 'auto';
  const tipRight = hPct < 55 ? 'auto' : `calc(${100 - hPct}% + 10px)`;

  return (
    <div>
      <div style={box}>
        <svg
          viewBox="0 0 1000 240"
          preserveAspectRatio="none"
          style={{ display: 'block', width: '100%', height }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--acc)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--acc)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {!isMini && (
            <>
              <line x1="0" y1="60" x2="1000" y2="60" stroke="var(--line)" strokeWidth={1} />
              <line x1="0" y1="120" x2="1000" y2="120" stroke="var(--line)" strokeWidth={1} />
              <line x1="0" y1="180" x2="1000" y2="180" stroke="var(--line)" strokeWidth={1} />
            </>
          )}
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="var(--acc)"
            strokeWidth={1.8}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {!isMini && hoverIdx != null && (
          <>
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${hPct}%`,
                width: 1,
                background: 'var(--line2)',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `calc(${hPct}% - 4px)`,
                top: `calc(${yPct}% - 4px)`,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--acc)',
                border: '2px solid var(--bg)',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: tipLeft,
                right: tipRight,
                background: 'var(--surf2)',
                border: '1px solid var(--line2)',
                borderRadius: 8,
                padding: '6px 10px',
                fontFamily: mono,
                fontSize: 11,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                zIndex: 5,
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtUsd(values[hoverIdx])}</span>
              <span style={{ color: 'var(--mut)', marginLeft: 8 }}>
                {dateLabel(times[hoverIdx], period)}
              </span>
            </div>
          </>
        )}

        {!isMini && (
          <>
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 10,
                fontFamily: mono,
                fontSize: 10,
                color: 'var(--mut)',
                pointerEvents: 'none',
              }}
            >
              {fmtUsd0(mx)}
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                right: 10,
                fontFamily: mono,
                fontSize: 10,
                color: 'var(--mut)',
                pointerEvents: 'none',
              }}
            >
              {fmtUsd0(Math.max(mn, 0))}
            </div>
            <div
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
              }}
              onMouseLeave={() => setHover(null)}
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
            />
          </>
        )}
      </div>

      {!isMini && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6,
            fontFamily: mono,
            fontSize: 10,
            color: 'var(--mut)',
          }}
        >
          <span>{dateLabel(times[0], period)}</span>
          <span>NOW</span>
        </div>
      )}
    </div>
  );
}
