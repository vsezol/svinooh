import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { HistoryRange } from '@svinooh/shared';
import { fmtUsd } from '../lib/format';
import { useTheme } from '../lib/theme';

interface Props {
  values: number[];
  times: number[]; // ms, same length
  period: HistoryRange;
  height: string;
}

/** What a drag across the chart selected */
interface Selection {
  fromIndex: number;
  toIndex: number;
  fromX: number;
  toX: number;
}

/**
 * One finger scrolls the chart. A mouse drag does not — that gesture belongs to
 * selecting a range — and neither does the wheel, which belongs to the page.
 */
const SCROLL = {
  mouseWheel: false,
  pressedMouseMove: false,
  horzTouchDrag: true,
  vertTouchDrag: false,
} as const;

/**
 * The narrowest a point may be drawn before the chart stops trying to fit the
 * whole period into the width and becomes scrollable instead. A day of history
 * squeezed into a phone is a couple of pixels per reading — a shape, not a
 * chart. Below this it shows the recent end at a legible density and lets you
 * scroll back for the rest.
 */
const MIN_POINT_PX = 3;

const token = (name: string): string =>
  getComputedStyle(document.body).getPropertyValue(name).trim() || '#2bd576';

function dateLabel(ms: number, period: HistoryRange): string {
  const d = new Date(ms);
  return period === '24h'
    ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * TradingView's Lightweight Charts (Apache-2.0).
 *
 * One gesture, one meaning, and nothing shares:
 *
 *  - one finger, dragging — scrolls the chart
 *  - one finger, held — the library's tracking crosshair, for reading the value
 *    at a point; it follows the finger until the next tap
 *  - two fingers — selects the span between them and says what the portfolio
 *    did across it
 *  - a mouse drag — the same selection, since a mouse has only the one gesture
 *
 * Zoom is deliberately absent. The period buttons decide how much history is on
 * screen, and a second, gestural way to change it only ever leaves people at a
 * scale they did not pick and cannot name.
 *
 * Nothing is drawn behind the line: gridlines on a 200px sparkline of one
 * portfolio are decoration that competes with the only thing worth reading.
 */
export function AreaChart({ values, times, period, height }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  const { theme } = useTheme();

  const [hover, setHover] = useState<{ index: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  // Lightweight Charts wants seconds, strictly ascending and unique — the
  // history can carry two points inside one second after downsampling.
  const data = (() => {
    const out: Array<{ time: UTCTimestamp; value: number }> = [];
    let last = -1;
    for (let i = 0; i < values.length; i++) {
      const t = Math.floor(times[i] / 1000);
      const time = (t <= last ? last + 1 : t) as UTCTimestamp;
      last = time;
      out.push({ time, value: values[i] });
    }
    return out;
  })();

  // Build once; data and colours are pushed in by the effects below
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      handleScroll: SCROLL,
      // No zooming, by choice. The period buttons decide how much history is on
      // screen; a second, gestural way to change it only ever leaves people at a
      // scale they did not pick and cannot name.
      handleScale: false,
      layout: { background: { color: 'transparent' }, attributionLogo: false },
      leftPriceScale: { visible: false },
      rightPriceScale: { visible: false },
      // Held to the data's own edges: scrolling runs out where the history
      // does, rather than into empty space
      timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { style: LineStyle.Dotted, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      grid: { horzLines: { visible: false }, vertLines: { visible: false } },
    });
    chart.current = c;
    series.current = c.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    c.subscribeCrosshairMove((param) => {
      const index = param.logical;
      setHover(index == null ? null : { index: Math.round(index) });
    });
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  // Colours follow the theme
  useEffect(() => {
    if (!chart.current || !series.current) return;
    const acc = token('--acc');
    const mut = token('--mut');
    series.current.applyOptions({
      lineColor: acc,
      topColor: `color-mix(in srgb, ${acc} 22%, transparent)`,
      bottomColor: `color-mix(in srgb, ${acc} 0%, transparent)`,
    });
    chart.current.applyOptions({ crosshair: { vertLine: { color: mut } } });
  }, [theme]);

  useEffect(() => {
    series.current?.setData(data);
    const scale = chart.current?.timeScale();
    const width = box.current?.clientWidth ?? 0;
    if (scale && width && values.length) {
      if (width / values.length >= MIN_POINT_PX) {
        scale.fitContent();
      } else {
        // Too many readings for the width: draw them at a legible size, park
        // the view on the newest, and let the rest be scrolled back to
        scale.applyOptions({ barSpacing: MIN_POINT_PX });
        scale.scrollToRealTime();
      }
    }
    setSelection(null);
    // Re-running on every array identity would reset the selection on each
    // poll; the length and the endpoints are what actually change the picture.
  }, [values.length, times[0], times[times.length - 1], values[values.length - 1]]);

  /** Screen x → index in the series */
  const indexAt = (clientX: number): number | null => {
    if (!chart.current || !box.current || !values.length) return null;
    const x = clientX - box.current.getBoundingClientRect().left;
    const logical = chart.current.timeScale().coordinateToLogical(x);
    if (logical == null) return null;
    return Math.min(values.length - 1, Math.max(0, Math.round(logical)));
  };

  const xAt = (index: number): number => {
    const c = chart.current?.timeScale().logicalToCoordinate(index as never);
    return typeof c === 'number' ? c : 0;
  };

  /**
   * Two fingers select a span; the chart is told to sit still while they are
   * down, or it would scroll under them as they move.
   *
   * Native listeners rather than React's, because stopping the browser from
   * treating two fingers as a page gesture needs preventDefault, and React
   * attaches touch handlers passively — where preventDefault does nothing.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;

    const spanOf = (touches: TouchList): Selection | null => {
      const a = indexAt(touches[0].clientX);
      const b = indexAt(touches[1].clientX);
      if (a == null || b == null || Math.abs(a - b) < 1) return null;
      const [from, to] = a < b ? [a, b] : [b, a];
      return { fromIndex: from, toIndex: to, fromX: xAt(from), toX: xAt(to) };
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      chart.current?.applyOptions({ handleScroll: false });
      setSelection(spanOf(e.touches));
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const span = spanOf(e.touches);
      if (span) setSelection(span);
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0) chart.current?.applyOptions({ handleScroll: SCROLL });
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
    // indexAt/xAt read refs, so they stay correct without being dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.length]);

  /**
   * A mouse drag across the chart selects a span. Nothing competes for it: the
   * chart only scrolls under a finger, and the wheel is left to the page.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const index = indexAt(e.clientX);
    if (index == null) return;
    drag.current = { startX: index, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !drag.current) return;
    const index = indexAt(e.clientX);
    if (index == null) return;
    const from = Math.min(drag.current.startX, index);
    const to = Math.max(drag.current.startX, index);
    if (to - from < 1) return; // not a drag yet
    drag.current.moved = true;
    setSelection({ fromIndex: from, toIndex: to, fromX: xAt(from), toX: xAt(to) });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    // A tap, not a drag — clear whatever was selected
    if (drag.current && !drag.current.moved) setSelection(null);
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const range = selection
    ? (() => {
        const from = values[selection.fromIndex];
        const to = values[selection.toIndex];
        const chg = to - from;
        return {
          chg,
          pct: from ? (chg / from) * 100 : 0,
          up: chg >= 0,
          label: `${dateLabel(times[selection.fromIndex], period)} → ${dateLabel(times[selection.toIndex], period)}`,
        };
      })()
    : null;

  const hovered = hover && hover.index >= 0 && hover.index < values.length ? hover.index : null;

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y' }}>
      <div
        ref={box}
        style={{ height, width: '100%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* the selected span */}
      {selection ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: Math.min(selection.fromX, selection.toX),
            width: Math.abs(selection.toX - selection.fromX),
            background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
            borderLeft: '1px solid color-mix(in srgb, var(--acc) 55%, transparent)',
            borderRight: '1px solid color-mix(in srgb, var(--acc) 55%, transparent)',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* what the selection is worth, or the value under the cursor */}
      <div
          className="mono"
          style={{
            position: 'absolute',
            top: 8,
            left: 12,
            fontSize: 11,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'baseline',
            gap: 9,
          }}
        >
          {range ? (
            <>
              <span style={{ fontWeight: 600, color: range.up ? 'var(--up)' : 'var(--down)' }}>
                {(range.up ? '+' : '−') + fmtUsd(Math.abs(range.chg), 0)} ({range.up ? '+' : ''}
                {range.pct.toFixed(2)}%)
              </span>
              <span style={{ color: 'var(--mut)' }}>{range.label}</span>
            </>
          ) : hovered !== null ? (
            <>
              <span style={{ fontWeight: 600 }}>{fmtUsd(values[hovered])}</span>
              <span style={{ color: 'var(--mut)' }}>{dateLabel(times[hovered], period)}</span>
            </>
          ) : null}
      </div>

      {values.length ? (
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 6,
            left: 12,
            right: 12,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'var(--mut)',
            pointerEvents: 'none',
          }}
        >
          <span>{dateLabel(times[0], period)}</span>
          <span>NOW</span>
        </div>
      ) : null}
    </div>
  );
}
