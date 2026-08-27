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

/**
 * What a drag across the chart selected, as two readings rather than two
 * pixel positions — the chart scrolls underneath it now, and a span pinned to
 * pixels would stay behind while the readings it measures slid away.
 */
interface Selection {
  fromIndex: number;
  toIndex: number;
}

/**
 * A drag moves the chart, with a finger or with a mouse — it is the first thing
 * anyone tries, and a chart that does not move under it reads as broken. The
 * wheel stays out of it: the chart sits in the middle of a page people scroll
 * past, and a chart that swallows the wheel traps them on it.
 */
const SCROLL = {
  mouseWheel: false,
  pressedMouseMove: true,
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
 *  - a mouse drag — scrolls the chart, the same as one finger
 *  - shift and a mouse drag — the same selection. A mouse has one button and
 *    two things to do with it, so one of them takes a modifier; TradingView
 *    measures on shift-drag as well, and this is their chart.
 *
 * Both are pointer events, which already carry an id per finger and say which
 * input they came from; the library has no selection of its own to borrow, and
 * a gesture library would hand back a pinch — a distance and a centre — when
 * what this needs is where each of the two fingers actually is.
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
  /**
   * The mouse gesture in progress. `measuring` is decided at the press, not
   * read per move: letting go of shift halfway through a measurement should
   * finish it, not turn it into a scroll.
   */
  const drag = useRef<{ index: number; clientX: number; measuring: boolean; moved: boolean } | null>(null);
  /** Fingers currently on the chart, by pointer id → x. Two of them select a span. */
  const touches = useRef(new Map<number, number>());
  const { theme } = useTheme();

  const [hover, setHover] = useState<{ index: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  /** Where the selected span currently falls on screen — see the effect that keeps it there */
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);

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

  const spanBetween = (from: number, to: number): void => {
    const a = indexAt(from);
    const b = indexAt(to);
    if (a == null || b == null || Math.abs(a - b) < 1) return;
    setSelection(a < b ? { fromIndex: a, toIndex: b } : { fromIndex: b, toIndex: a });
  };

  /**
   * The span is drawn in pixels over a chart that moves, so it is placed again
   * every time the view does — scroll away from a measured span and the band
   * goes with the readings it measures, and off the edge with them.
   */
  useEffect(() => {
    const scale = chart.current?.timeScale();
    if (!scale) return;
    const place = () => {
      if (!selection) {
        setBand(null);
        return;
      }
      const a = xAt(selection.fromIndex);
      const b = xAt(selection.toIndex);
      setBand({ left: Math.min(a, b), width: Math.abs(b - a) });
    };
    place();
    scale.subscribeVisibleLogicalRangeChange(place);
    return () => scale.unsubscribeVisibleLogicalRangeChange(place);
    // xAt reads refs, so it stays correct without being a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  /**
   * Both gestures, on one event model.
   *
   * Pointer events already say which input each one came from and carry an id
   * per finger, which is all this needs — and `touch-action: pan-y` on the card
   * is what stops the browser claiming a two-finger gesture for itself, so
   * there is nothing to preventDefault and no reason to reach past React for a
   * non-passive listener.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, e.clientX);
      const [a, b] = [...touches.current.values()];
      if (touches.current.size === 2) {
        // Or the chart would scroll out from under the fingers measuring it
        chart.current?.applyOptions({ handleScroll: false });
        spanBetween(a, b);
      }
      return;
    }
    const index = indexAt(e.clientX);
    if (index == null) return;
    drag.current = { index, clientX: e.clientX, measuring: e.shiftKey, moved: false };
    if (!e.shiftKey) return;
    // Both gestures are the same button held and moved, so the chart is told to
    // sit still for the length of a measurement — otherwise it scrolls out from
    // under the span being measured. The library reads this on every move, so
    // switching it here, after its own press handler has run, is in time.
    chart.current?.applyOptions({ handleScroll: false });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, e.clientX);
      const [a, b] = [...touches.current.values()];
      if (touches.current.size === 2) spanBetween(a, b);
      return;
    }
    if (!drag.current) return;
    // In pixels, not in readings: a scroll drags the chart along with the
    // cursor, so the reading under it barely changes and a real drag would go
    // on looking like a click
    if (Math.abs(e.clientX - drag.current.clientX) > 2) drag.current.moved = true;
    if (!drag.current.measuring) return;
    const index = indexAt(e.clientX);
    if (index == null) return;
    const from = Math.min(drag.current.index, index);
    const to = Math.max(drag.current.index, index);
    if (to - from < 1) return; // not a span yet
    setSelection({ fromIndex: from, toIndex: to });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      // Only once the hand is off: lifting one finger of two would otherwise
      // hand the other one a scroll it never asked for
      if (touches.current.size === 0) chart.current?.applyOptions({ handleScroll: SCROLL });
      return;
    }
    // A click, not a drag — clear whatever was selected
    if (drag.current && !drag.current.moved) setSelection(null);
    if (drag.current?.measuring) chart.current?.applyOptions({ handleScroll: SCROLL });
    drag.current = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
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
      {band ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: band.left,
            width: band.width,
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

      {/* The measuring gesture has nothing on screen to reach for, and a
          modifier nobody knows about is a feature nobody has. Mouse only — a
          phone measures with two fingers and has no shift to hold. */}
      {values.length && !selection && hovered === null ? (
        <div
          className="mono mouse-only"
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontSize: 9.5,
            letterSpacing: '0.1em',
            color: 'var(--mut)',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        >
          SHIFT-DRAG TO MEASURE
        </div>
      ) : null}

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
