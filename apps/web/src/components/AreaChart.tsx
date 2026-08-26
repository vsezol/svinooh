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

/** Drag moves it, with a finger or a mouse; the wheel is spent on zooming */
const SCROLL = {
  mouseWheel: false,
  pressedMouseMove: true,
  horzTouchDrag: true,
  vertTouchDrag: false,
} as const;

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
 * It behaves like a chart: drag moves it, the wheel and a pinch zoom, a double
 * click on the scale puts it back. Measuring a span — drag across it and read
 * what the portfolio did over it — is the same gesture, so it moved onto
 * shift-drag. Scrolling is what people reach for first and it should be what
 * they get.
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
      // Drag it, wheel it, pinch it — the chart moves, the way a chart should.
      // Measuring a span is still here, on shift-drag, because those are the
      // same gesture and scrolling is the one people reach for first.
      handleScroll: SCROLL,
      // The wheel and a pinch zoom in; scrolling only means anything once
      // something is off-screen, so without this the drag would move nothing
      // and the chart would look broken rather than fitted.
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: false,
        axisDoubleClickReset: true,
      },
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
    chart.current?.timeScale().fitContent();
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
   * Shift turns the drag from scrolling into measuring. The chart's own
   * scrolling has to be switched off while it is held, or the two gestures
   * both act on the same pointer and the chart slides out from under the
   * selection.
   */
  useEffect(() => {
    const set = (measuring: boolean) => {
      chart.current?.applyOptions({ handleScroll: measuring ? false : SCROLL });
      if (!measuring) setSelection(null);
    };
    const down = (e: KeyboardEvent) => e.key === 'Shift' && set(true);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && set(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.shiftKey) return;
    const index = indexAt(e.clientX);
    if (index == null) return;
    drag.current = { startX: index, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const index = indexAt(e.clientX);
    if (index == null) return;
    const from = Math.min(drag.current.startX, index);
    const to = Math.max(drag.current.startX, index);
    if (to - from < 1) return; // not a drag yet
    drag.current.moved = true;
    setSelection({ fromIndex: from, toIndex: to, fromX: xAt(from), toX: xAt(to) });
  };

  const onPointerUp = (e: React.PointerEvent) => {
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
