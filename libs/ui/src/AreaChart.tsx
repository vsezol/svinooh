'use client';

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
import { fmtUsd } from './money';
import { useThemeName } from './useThemeName';

/**
 * How wide a window each period puts on screen. `all` has no fixed width — it
 * is however much history there is.
 */
const WINDOW_MS: Record<HistoryRange, number | null> = {
  '1h': 3600e3,
  '24h': 24 * 3600e3,
  '7d': 7 * 86400e3,
  '30d': 30 * 86400e3,
  all: null,
};

interface Props {
  values: number[];
  times: number[]; // ms, same length
  period: HistoryRange;
  height: string;
  /**
   * Drawn as the whole background of a metric card: the same chart and the
   * same gestures, edge to edge. What goes is the furniture the card provides
   * for itself — the border, the dates along the bottom, the modifier hint —
   * and the line is held to the lower half so the card's text has clear air
   * above it. The readout moves to the top right, out from under that text.
   */
  bare?: boolean;
  /**
   * Whether to draw the card around it. On by default; off for a chart that is
   * already inside one — the assistant puts these in a message that has its
   * own frame, and two borders a pixel apart is a mistake, not a nest.
   *
   * Separate from `bare` on purpose. `bare` is a whole treatment — fill the
   * box, hold the line to the lower third, drop the dates — for a chart drawn
   * as the background of a metric card. Not wanting a border is not that.
   */
  framed?: boolean;
  /**
   * `muted` is what a debt is drawn in: a grey line rather than the accent
   * green, a grey band when a span is measured, and the change across that span
   * read the other way round — owing more is the losing direction, so a rising
   * debt is red and a falling one green.
   */
  tone?: 'accent' | 'muted';
  /**
   * Moments worth pointing at on the time axis — money arriving or leaving.
   *
   * Drawn as a rule through the chart rather than as a dot on the line, because
   * what they mark is a TIME and not a value: the deposit did not happen at
   * $103,204, it happened on Tuesday. Hovering one says what it was.
   */
  marks?: ChartMark[];
}

export interface ChartMark {
  /** When it happened, in ms */
  t: number;
  /** `in` is drawn in the rising colour, `out` in the falling one */
  direction: 'in' | 'out';
  /** What the hover card says — a line each */
  lines: string[];
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

const token = (name: string): string =>
  getComputedStyle(document.body).getPropertyValue(name).trim() || '#2bd576';

function dateLabel(ms: number, period: HistoryRange): string {
  const d = new Date(ms);
  return period === '1h' || period === '24h'
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
export function AreaChart({
  values,
  times,
  period,
  height,
  bare = false,
  framed = true,
  tone = 'accent',
  marks = [],
}: Props) {
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
  const theme = useThemeName();

  const [hover, setHover] = useState<{ index: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  /** Where the selected span currently falls on screen — see the effect that keeps it there */
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);
  /**
   * Where each mark currently falls, in the same pixels and kept there the same
   * way. A mark off the visible edge is left out rather than clamped: a rule
   * pinned to the border of a chart it is no longer on is a claim about a time
   * that is not shown.
   */
  const [markAt, setMarkAt] = useState<Array<{ mark: ChartMark; x: number }>>([]);
  const [markHover, setMarkHover] = useState<number | null>(null);
  /** The stretch of time on screen, in ms — what the labels underneath report */
  const [shown, setShown] = useState<{ from: number; to: number } | null>(null);

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

  /**
   * A cheap stand-in for the whole series, for the effect that pushes it in.
   * That effect cannot depend on the arrays themselves — a poll hands back new
   * ones whether or not anything moved, and clearing a measurement every minute
   * is worse than the thing it fixes — but the length and the endpoints alone
   * are not enough either: switching wallets replaces every reading while
   * leaving the time grid exactly where it was, and the wallet you just left
   * stayed drawn on the card.
   */
  const fingerprint = (() => {
    let sum = 0;
    for (const v of values) sum += v;
    return `${values.length}:${times[0] ?? 0}:${times[times.length - 1] ?? 0}:${sum}`;
  })();

  /** The same trick for the marks — a poll hands back a new array either way */
  const markPrint = marks.map((m) => `${m.t}${m.direction}`).join(',');

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
    // As a card's background the line keeps to the lower third, clear of the
    // card's own text above it
    if (bare) series.current.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.1 } });
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

  /**
   * Now that the chart holds more than it shows, the labels underneath cannot
   * go on naming the ends of the data — they name the ends of the window, and
   * follow it as it moves.
   */
  useEffect(() => {
    const scale = chart.current?.timeScale();
    if (!scale) return;
    const read = () => {
      const range = scale.getVisibleRange();
      setShown(range ? { from: (range.from as number) * 1000, to: (range.to as number) * 1000 } : null);
    };
    read();
    scale.subscribeVisibleTimeRangeChange(read);
    return () => scale.unsubscribeVisibleTimeRangeChange(read);
  }, []);

  // Colours follow the theme
  useEffect(() => {
    if (!chart.current || !series.current) return;
    const mut = token('--mut');
    // The grey line softened a step, the way the design draws it — full-strength
    // grey reads nearly as loud as the accent on a dark card. As hex-with-alpha:
    // the library parses line colours itself and does not know color-mix().
    const line =
      tone === 'muted' ? (/^#[0-9a-f]{6}$/i.test(mut) ? `${mut}d9` : mut) : token('--acc');
    series.current.applyOptions({
      lineColor: line,
      topColor: `color-mix(in srgb, ${line} ${tone === 'muted' ? 14 : 22}%, transparent)`,
      bottomColor: `color-mix(in srgb, ${line} 0%, transparent)`,
    });
    chart.current.applyOptions({ crosshair: { vertLine: { color: mut } } });
  }, [theme, tone]);

  /**
   * The period is the width of the window: 24H puts one day across the chart
   * and leaves the days before it to be scrolled back to. What arrives covers
   * several windows, so what is shown has to be cut to one — the newest one.
   *
   * Until there is more history than the window is wide there is nothing to cut
   * and nothing to scroll, and the line fills the width the way it always did.
   */
  useEffect(() => {
    series.current?.setData(data);
    const scale = chart.current?.timeScale();
    if (scale && data.length) {
      const window = WINDOW_MS[period];
      const last = data[data.length - 1].time as number;
      const from = window === null ? null : last - Math.floor(window / 1000);
      if (from === null || from <= (data[0].time as number)) scale.fitContent();
      else scale.setVisibleRange({ from: from as UTCTimestamp, to: last as UTCTimestamp });
    }
    setSelection(null);
  }, [period, fingerprint]);

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
   * The marks, placed the same way and for the same reason: they are pixels
   * over a chart that scrolls, so they are placed again every time it moves.
   *
   * A mark sits at a moment in time, and the series is a list of readings — so
   * the moment is turned into a position by finding the reading it falls
   * between and asking the chart where that index is. Nothing is drawn outside
   * the box: past the edge, `logicalToCoordinate` keeps answering, and a rule
   * left pinned to the border would be pointing at a time not on screen.
   */
  useEffect(() => {
    const scale = chart.current?.timeScale();
    if (!scale) return;
    const place = () => {
      if (!marks.length || times.length < 2) {
        setMarkAt([]);
        return;
      }
      const width = box.current?.clientWidth ?? 0;
      const placed: Array<{ mark: ChartMark; x: number }> = [];
      for (const mark of marks) {
        // The fractional index of this moment between two readings, so a mark
        // lands where it happened rather than snapping to the nearest scan
        let i = 0;
        while (i + 1 < times.length && times[i + 1] <= mark.t) i++;
        const span = (times[i + 1] ?? times[i]) - times[i];
        const within = span > 0 ? Math.min(1, Math.max(0, (mark.t - times[i]) / span)) : 0;
        const x = chart.current?.timeScale().logicalToCoordinate((i + within) as never);
        if (typeof x !== 'number' || x < 0 || x > width) continue;
        placed.push({ mark, x });
      }
      setMarkAt(placed);
    };
    place();
    scale.subscribeVisibleLogicalRangeChange(place);
    return () => scale.unsubscribeVisibleLogicalRangeChange(place);
    // times is read through the closure and re-run through markPrint/fingerprint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markPrint, fingerprint, period]);

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
      if (touches.current.size === 0) {
        chart.current?.applyOptions({ handleScroll: SCROLL });
        // A measurement made with two fingers lasts as long as they do. There
        // is no cursor to leave it under and no click to dismiss it with, so
        // the span that outlives the hand is a band nobody can get rid of —
        // and the next thing anyone does is scroll, which would drag it along.
        setSelection(null);
      }
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
        const up = chg >= 0;
        return {
          chg,
          pct: from ? (chg / from) * 100 : 0,
          up,
          // Which way is the good way. On a debt it is down: the sign in front
          // of the number stays what it is, only the colour behind it flips.
          good: tone === 'muted' ? !up : up,
          label: `${dateLabel(times[selection.fromIndex], period)} → ${dateLabel(times[selection.toIndex], period)}`,
        };
      })()
    : null;

  const hovered = hover && hover.index >= 0 && hover.index < values.length ? hover.index : null;
  /** The band belongs to the line, so it is drawn in the line's own colour */
  const SELECTION = tone === 'muted' ? 'var(--mut)' : 'var(--acc)';

  return (
    <div
      // A sideways drag here belongs to the chart — it is how you scroll back
      // through the history — so the pager that carries this page leaves any
      // gesture starting inside alone. See usePager.
      data-no-swipe=""
      className={bare || !framed ? undefined : 'ui-card'}
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y', height: bare ? '100%' : undefined }}
    >
      <div
        ref={box}
        style={{ height, width: '100%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* the selected span — in the colour of the line it is measuring */}
      {band ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: band.left,
            width: band.width,
            background: `color-mix(in srgb, ${SELECTION} 12%, transparent)`,
            borderLeft: `1px solid color-mix(in srgb, ${SELECTION} 55%, transparent)`,
            borderRight: `1px solid color-mix(in srgb, ${SELECTION} 55%, transparent)`,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* Money arriving or leaving: a rule through the chart at the moment it
          happened. Hit area is wider than the line — a 1px target is not one.
          The z-index is not decoration: the library stacks its own canvases at
          1 and 2, and one of them is transparent and covers the whole chart —
          so a mark without it is drawn (the canvas lets the colour through) and
          cannot be hovered (the canvas takes the pointer). */}
      {markAt.map(({ mark, x }, i) => {
        const colour = mark.direction === 'in' ? 'var(--up)' : 'var(--down)';
        return (
          <div
            key={`${mark.t}-${i}`}
            onPointerEnter={() => setMarkHover(i)}
            onPointerLeave={() => setMarkHover((at) => (at === i ? null : at))}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: x - 6,
              width: 12,
              zIndex: 3,
              display: 'flex',
              justifyContent: 'center',
              cursor: 'help',
            }}
          >
            <div
              style={{
                width: 2,
                height: '100%',
                background: `color-mix(in srgb, ${colour} ${markHover === i ? 90 : 42}%, transparent)`,
                transition: 'background 0.15s ease',
              }}
            />
          </div>
        );
      })}

      {/* What the hovered mark was. Placed against whichever edge keeps it on
          the chart, and transparent to the pointer so moving onto it does not
          count as leaving the mark that opened it. */}
      {markHover !== null && markAt[markHover] ? (
        <div
          className="mono"
          style={{
            position: 'absolute',
            top: bare ? 26 : 30,
            ...(markAt[markHover].x > (box.current?.clientWidth ?? 0) / 2
              ? { right: Math.max(8, (box.current?.clientWidth ?? 0) - markAt[markHover].x + 8) }
              : { left: markAt[markHover].x + 8 }),
            maxWidth: 'min(220px, 70%)',
            padding: '7px 9px',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--line)',
            background: 'var(--surf)',
            boxShadow: 'var(--shadow-pop)',
            fontSize: 'var(--fs-note)',
            lineHeight: 1.45,
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {markAt[markHover].mark.lines.map((line, n) => (
            <div
              key={n}
              style={{
                color: n === 0 ? 'var(--text)' : 'var(--mut)',
                fontWeight: n === 0 ? 'var(--fw-medium)' : undefined,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {/* what the selection is worth, or the value under the cursor */}
      {/* In a card the top left belongs to the card's own text, so the reading
          moves to the top right and carries its own ground the way a tooltip
          does — it may sit over the line it is reporting */}
      <div
          className="mono"
          style={{
            position: 'absolute',
            top: 8,
            ...(bare ? { right: 10 } : { left: 12 }),
            fontSize: 'var(--fs-tag)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'baseline',
            gap: bare ? 7 : 9,
            ...(bare ? { background: 'var(--surf)', padding: '2px 6px', borderRadius: 'var(--r-sm)' } : null),
          }}
        >
          {range ? (
            <>
              <span style={{ fontWeight: 'var(--fw-medium)', color: range.good ? 'var(--up)' : 'var(--down)' }}>
                {(range.up ? '+' : '−') + fmtUsd(Math.abs(range.chg), 0)} ({range.up ? '+' : ''}
                {range.pct.toFixed(2)}%)
              </span>
              <span style={{ color: 'var(--mut)' }}>{range.label}</span>
            </>
          ) : hovered !== null ? (
            <>
              <span style={{ fontWeight: 'var(--fw-medium)' }}>{fmtUsd(values[hovered])}</span>
              <span style={{ color: 'var(--mut)' }}>{dateLabel(times[hovered], period)}</span>
            </>
          ) : null}
      </div>

      {/* The measuring gesture has nothing on screen to reach for, and a
          modifier nobody knows about is a feature nobody has. Mouse only — a
          phone measures with two fingers and has no shift to hold. */}
      {values.length && !selection && hovered === null && !bare ? (
        <div
          className="mono mouse-only"
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontSize: 'var(--fs-micro)',
            letterSpacing: '0.1em',
            color: 'var(--mut)',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        >
          SHIFT-DRAG TO MEASURE
        </div>
      ) : null}

      {values.length && !bare ? (
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 6,
            left: 12,
            right: 12,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 'var(--fs-micro)',
            color: 'var(--mut)',
            pointerEvents: 'none',
          }}
        >
          <span>{dateLabel(shown ? shown.from : times[0], period)}</span>
          {/* Scrolled off the live edge, the right-hand end is a time like any
              other; sitting on it, it is the only one worth naming. */}
          <span>
            {shown && shown.to < times[times.length - 1] - 1000 ? dateLabel(shown.to, period) : 'NOW'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
