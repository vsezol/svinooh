'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  AreaSeries,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { HistoryRange } from '@svinooh/shared';
import { nearestIndex, useChartSync } from './chartSync';
import { forecast, type Forecast, type Line } from './forecast';
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
  format?: (value: number) => string;
  lines?: ReadonlyArray<ChartLine>;
  showForecast?: boolean;
}

export interface ChartLine {
  label: string;
  values: number[];
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

const lineColor = (index: number): string => token(index < 4 ? `--series-${index + 1}` : '--mut');

/**
 * The grey line softened a step, the way the design draws it — full-strength
 * grey reads nearly as loud as the accent on a dark card. As hex-with-alpha:
 * the library parses line colours itself and does not know color-mix().
 */
function mainColor(tone: 'accent' | 'muted'): string {
  const mut = token('--mut');
  return tone === 'muted' ? (/^#[0-9a-f]{6}$/i.test(mut) ? `${mut}d9` : mut) : token('--acc');
}

function faded(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}80` : color;
}

function aheadData(ahead: Line, from: UTCTimestamp): Array<{ time: UTCTimestamp; value: number }> {
  const out = [{ time: from, value: ahead.values[0] }];
  for (let i = 1; i < ahead.times.length; i++) {
    const t = Math.floor(ahead.times[i] / 1000);
    const last = out[out.length - 1].time as number;
    out.push({ time: (t <= last ? last + 1 : t) as UTCTimestamp, value: ahead.values[i] });
  }
  return out;
}

function toData(values: number[], times: number[]): Array<{ time: UTCTimestamp; value: number }> {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  let last = -1;
  for (let i = 0; i < values.length; i++) {
    const t = Math.floor(times[i] / 1000);
    const time = (t <= last ? last + 1 : t) as UTCTimestamp;
    last = time;
    out.push({ time, value: values[i] });
  }
  return out;
}

function aheadLabel(ms: number, period: HistoryRange): string {
  const day = new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return period === '1h' || period === '24h' ? `${day}, ${dateLabel(ms, period)}` : day;
}

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
  values: single,
  times,
  period,
  height,
  bare = false,
  framed = true,
  tone = 'accent',
  format,
  lines,
  showForecast = false,
}: Props) {
  const multi = !!lines?.length;
  const values = multi ? lines[0].values : single;
  const drawnLines = multi ? lines.map((line) => line.values) : [values];
  const forecasts = showForecast ? drawnLines.map((line) => forecast(line, times, WINDOW_MS[period])) : [];
  const ahead = forecasts.find((one): one is Forecast => one !== null)?.ahead ?? null;
  const aheadLength = ahead ? ahead.times.length - 1 : 0;
  const lastIndex = values.length - 1 + aheadLength;
  const timeAt = (index: number) => (index < values.length ? times[index] : ahead!.times[index - values.length + 1]);
  const valueAt = (line: number, index: number) =>
    index < values.length ? drawnLines[line][index] : forecasts[line]?.ahead.values[index - values.length + 1];
  const fmtValue = format ?? fmtUsd;
  const fmtChange = format ?? ((value: number) => fmtUsd(value, 0));
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const lineSeries = useRef<Array<ISeriesApi<'Line'>>>([]);
  const aheadSeries = useRef<Array<ISeriesApi<'Line'>>>([]);
  const trendSeries = useRef<Array<ISeriesApi<'Line'>>>([]);
  /**
   * The mouse gesture in progress. `measuring` is decided at the press, not
   * read per move: letting go of shift halfway through a measurement should
   * finish it, not turn it into a scroll.
   */
  const drag = useRef<{ index: number; clientX: number; measuring: boolean; moved: boolean } | null>(null);
  /** Fingers currently on the chart, by pointer id → x. Two of them select a span. */
  const touches = useRef(new Map<number, number>());
  const theme = useThemeName();

  /** This chart's name among the charts it is drawn beside */
  const id = useId();
  const { shared, publish } = useChartSync();

  const [hover, setHover] = useState<{ index: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  /** Where the selected span currently falls on screen — see the effect that keeps it there */
  const [band, setBand] = useState<{ left: number; width: number } | null>(null);
  /** The stretch of time on screen, in ms — what the labels underneath report */
  const [shown, setShown] = useState<{ from: number; to: number } | null>(null);

  /** What the handlers installed once would otherwise have to close over */
  const latest = useRef({ times, publish, id });
  latest.current = { times, publish, id };

  // Lightweight Charts wants seconds, strictly ascending and unique — the
  // history can carry two points inside one second after downsampling.
  const data = toData(values, times);

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
    const drawn = multi ? lines.flatMap((line) => line.values) : values;
    for (const v of drawn) sum += v;
    return `${drawn.length}:${times[0] ?? 0}:${times[times.length - 1] ?? 0}:${sum}`;
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
    // As a card's background the line keeps to the lower third, clear of the
    // card's own text above it
    if (bare) series.current.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.1 } });
    c.subscribeCrosshairMove((param) => {
      const index = param.logical == null ? null : Math.round(param.logical);
      setHover(index == null ? null : { index });
      /**
       * Only a real pointer on THIS chart speaks for the group.
       *
       * `sourceEvent` is the library saying a person did this, and it is the
       * whole defence against a synchronised crosshair chasing itself: putting
       * the line on a chart makes it report a move like any other, and a chart
       * that answered would be telling the chart that told it.
       */
      if (!param.sourceEvent) return;
      const now = latest.current;
      const at = index == null || index < 0 || index >= now.times.length ? null : now.times[index];
      now.publish?.(now.id, { time: at });
    });
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      lineSeries.current = [];
      aheadSeries.current = [];
      trendSeries.current = [];
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
    const line = mainColor(tone);
    series.current.applyOptions({
      lineColor: line,
      topColor: `color-mix(in srgb, ${line} ${tone === 'muted' ? 14 : 22}%, transparent)`,
      bottomColor: `color-mix(in srgb, ${line} 0%, transparent)`,
    });
    chart.current.applyOptions({ crosshair: { vertLine: { color: mut } } });
    lineSeries.current.forEach((line, index) => line.applyOptions({ color: lineColor(index) }));
    aheadSeries.current.forEach((dashed, index) => dashed.applyOptions({ color: multi ? lineColor(index) : line }));
    trendSeries.current.forEach((trend, index) =>
      trend.applyOptions({ color: faded(multi ? lineColor(index) : line) }),
    );
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
    const c = chart.current;
    for (const line of lineSeries.current) c?.removeSeries(line);
    lineSeries.current = c
      ? (lines ?? []).map((line, index) => {
          const drawn = c.addSeries(LineSeries, {
            lineWidth: 2,
            color: lineColor(index),
            priceLineVisible: false,
            lastValueVisible: false,
          });
          drawn.setData(toData(line.values, times));
          return drawn;
        })
      : [];
    series.current?.setData(multi ? [] : data);
    for (const line of [...aheadSeries.current, ...trendSeries.current]) c?.removeSeries(line);
    const lastTime = data.length ? data[data.length - 1].time : null;
    const drawn = c && lastTime !== null ? forecasts.map((one, index) => (one ? { one, index } : null)) : [];
    const color = (index: number) => (multi ? lineColor(index) : mainColor(tone));
    trendSeries.current = drawn.flatMap((entry) => {
      if (!entry || !c) return [];
      const trend = c.addSeries(LineSeries, {
        lineWidth: 1,
        color: faded(color(entry.index)),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      trend.setData(
        entry.one.trend.values.map((value, k) => ({ time: data[entry.one.from + k].time, value })),
      );
      return [trend];
    });
    aheadSeries.current = drawn.flatMap((entry) => {
      if (!entry || !c || lastTime === null) return [];
      const dashed = c.addSeries(LineSeries, {
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        color: color(entry.index),
        priceLineVisible: false,
        lastValueVisible: false,
      });
      dashed.setData(aheadData(entry.one.ahead, lastTime));
      return [dashed];
    });
    const scale = chart.current?.timeScale();
    if (scale && data.length) {
      const window = WINDOW_MS[period];
      const last = data[data.length - 1].time as number;
      const to = ahead ? (aheadData(ahead, last as UTCTimestamp).at(-1)!.time as number) : last;
      const from = window === null ? null : last - Math.floor(window / 1000);
      if (from === null || from <= (data[0].time as number)) scale.fitContent();
      else scale.setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
    }
    setSelection(null);
  }, [period, fingerprint, showForecast]);

  /**
   * What another chart in the group is showing — nothing when this one is the
   * one being used, or when it stands alone.
   */
  const elsewhere = shared.source && shared.source !== id ? shared : null;
  /** The reading this chart has for the instant another chart is standing on */
  const followed = elsewhere?.time != null ? nearestIndex(times, elsewhere.time) : null;

  /** The crosshair another chart is holding, drawn here at the same instant */
  useEffect(() => {
    const c = chart.current;
    const s = series.current;
    if (!c || !s) return;
    if (followed == null) {
      // Not ours to clear while this chart is the one being pointed at: that
      // crosshair is the library's own, and clearing it would blink it away
      if (shared.source !== id) c.clearCrosshairPosition();
      return;
    }
    c.setCrosshairPosition(data[followed].value, data[followed].time, s);
    // `data` is rebuilt every render from the same readings; `followed` is what
    // actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followed, shared.source, id]);

  /** A span measured on another chart is the same span of time here */
  useEffect(() => {
    if (!elsewhere) return; // ours to keep — we are the one measuring
    const span = elsewhere.span;
    const from = span ? nearestIndex(times, span.from) : null;
    const to = span ? nearestIndex(times, span.to) : null;
    setSelection(
      from != null && to != null && from !== to
        ? { fromIndex: Math.min(from, to), toIndex: Math.max(from, to) }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elsewhere?.span?.from, elsewhere?.span?.to, Boolean(elsewhere)]);

  /**
   * A span this chart's own gesture made, said out loud.
   *
   * Only the gestures call this. A span that arrived from another chart is set
   * with `setSelection` and stays quiet, or the two would answer each other.
   */
  const share = (next: Selection | null): void => {
    if (multi) return;
    setSelection(next);
    publish?.(id, {
      span: next ? { from: timeAt(next.fromIndex), to: timeAt(next.toIndex) } : null,
    });
  };

  /** Screen x → index in the series */
  const indexAt = (clientX: number): number | null => {
    if (!chart.current || !box.current || !values.length) return null;
    const x = clientX - box.current.getBoundingClientRect().left;
    const logical = chart.current.timeScale().coordinateToLogical(x);
    if (logical == null) return null;
    return Math.min(lastIndex, Math.max(0, Math.round(logical)));
  };

  const xAt = (index: number): number => {
    const c = chart.current?.timeScale().logicalToCoordinate(index as never);
    return typeof c === 'number' ? c : 0;
  };

  const spanBetween = (from: number, to: number): void => {
    const a = indexAt(from);
    const b = indexAt(to);
    if (a == null || b == null || Math.abs(a - b) < 1) return;
    share(a < b ? { fromIndex: a, toIndex: b } : { fromIndex: b, toIndex: a });
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
      if (touches.current.size === 2 && !multi) {
        // Or the chart would scroll out from under the fingers measuring it
        chart.current?.applyOptions({ handleScroll: false });
        spanBetween(a, b);
      }
      return;
    }
    const index = indexAt(e.clientX);
    if (index == null) return;
    const measuring = e.shiftKey && !multi;
    drag.current = { index, clientX: e.clientX, measuring, moved: false };
    if (!measuring) return;
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
    share({ fromIndex: from, toIndex: to });
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
        share(null);
      }
      return;
    }
    // A click, not a drag — clear whatever was selected
    if (drag.current && !drag.current.moved) share(null);
    if (drag.current?.measuring) chart.current?.applyOptions({ handleScroll: SCROLL });
    drag.current = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const spanLabel = (index: number) =>
    index < values.length ? dateLabel(times[index], period) : aheadLabel(timeAt(index), period);

  const range = selection
    ? (() => {
        const from = valueAt(0, selection.fromIndex) ?? 0;
        const to = valueAt(0, selection.toIndex) ?? 0;
        const chg = to - from;
        const up = chg >= 0;
        return {
          chg,
          pct: from ? (chg / from) * 100 : 0,
          up,
          // Which way is the good way. On a debt it is down: the sign in front
          // of the number stays what it is, only the colour behind it flips.
          good: tone === 'muted' ? !up : up,
          label:
            `${spanLabel(selection.fromIndex)} → ${spanLabel(selection.toIndex)}` +
            (selection.toIndex >= values.length ? ' · FORECAST' : ''),
        };
      })()
    : null;

  const own = hover && hover.index >= 0 && hover.index <= lastIndex ? hover.index : null;
  /** Under this chart's own pointer, or under another chart's — the same reading either way */
  const hovered = own ?? followed;
  const isAhead = hovered !== null && hovered >= values.length;
  const outlook =
    !multi && ahead
      ? (() => {
          const end = ahead.values[ahead.values.length - 1];
          const now = values[values.length - 1];
          const chg = end - now;
          return { end, chg, pct: now ? (chg / Math.abs(now)) * 100 : 0, at: ahead.times[ahead.times.length - 1] };
        })()
      : null;
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
        onPointerLeave={() => {
          // Said out loud rather than left behind: the library reports a move
          // with no source event when the pointer goes, so the going is ours to
          // announce — the crosshair this chart put on the others leaves with it
          publish?.(id, { time: null });
        }}
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

      {/* what the selection is worth, or the value under the cursor */}
      {/* In a card the top left belongs to the card's own text, so the reading
          moves to the top right and carries its own ground the way a tooltip
          does — it may sit over the line it is reporting */}
      <div
          className="mono"
          style={{
            position: 'absolute',
            top: 8,
            ...(bare ? { right: 10 } : { left: 12, right: 12 }),
            fontSize: 'var(--fs-tag)',
            pointerEvents: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            rowGap: 4,
            alignItems: 'baseline',
            gap: bare ? 7 : 9,
            ...(bare ? { background: 'var(--surf)', padding: '2px 6px', borderRadius: 'var(--r-sm)' } : null),
          }}
        >
          {range ? (
            <>
              <span style={{ fontWeight: 'var(--fw-medium)', color: range.good ? 'var(--up)' : 'var(--down)' }}>
                {(range.up ? '+' : '−') + fmtChange(Math.abs(range.chg))} ({range.up ? '+' : ''}
                {range.pct.toFixed(2)}%)
              </span>
              <span style={{ color: 'var(--mut)' }}>{range.label}</span>
            </>
          ) : multi ? (
            <>
              {lines.map((line, index) => (
                <span key={line.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 2, borderRadius: 1, background: `var(--series-${index + 1}, var(--mut))` }} />
                  <span style={{ color: 'var(--mut)' }}>{line.label}</span>
                  {hovered !== null && valueAt(index, hovered) !== undefined ? (
                    <span style={{ fontWeight: 'var(--fw-medium)' }}>{fmtValue(valueAt(index, hovered)!)}</span>
                  ) : null}
                </span>
              ))}
              {hovered !== null ? (
                <span style={{ color: 'var(--mut)' }}>
                  {isAhead ? `FORECAST ${aheadLabel(timeAt(hovered), period)}` : dateLabel(timeAt(hovered), period)}
                </span>
              ) : null}
            </>
          ) : hovered !== null ? (
            <>
              <span style={{ fontWeight: 'var(--fw-medium)' }}>{fmtValue(valueAt(0, hovered)!)}</span>
              <span style={{ color: 'var(--mut)' }}>
                {isAhead ? `FORECAST ${aheadLabel(timeAt(hovered), period)}` : dateLabel(timeAt(hovered), period)}
              </span>
            </>
          ) : outlook ? (
            <>
              <span style={{ color: 'var(--mut)' }}>FORECAST</span>
              <span style={{ fontWeight: 'var(--fw-medium)' }}>{fmtValue(outlook.end)}</span>
              <span style={{ color: 'var(--mut)' }}>
                {(outlook.chg >= 0 ? '+' : '−') + fmtChange(Math.abs(outlook.chg))} ({outlook.chg >= 0 ? '+' : ''}
                {outlook.pct.toFixed(2)}%) by {aheadLabel(outlook.at, period)}
              </span>
            </>
          ) : null}
      </div>

      {/* The measuring gesture has nothing on screen to reach for, and a
          modifier nobody knows about is a feature nobody has. Mouse only — a
          phone measures with two fingers and has no shift to hold.

          Card furniture, so it needs the card to be ours: unframed, this is a
          chart inside somebody else's box, and in the assistant's it landed
          under that box's own reading in the same corner — two right-aligned
          mono labels stacked where the design has one. */}
      {values.length && !multi && !outlook && !selection && hovered === null && !bare && framed ? (
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
            {!shown || Math.abs(shown.to - times[times.length - 1]) <= 1000
              ? 'NOW'
              : shown.to > times[times.length - 1]
                ? aheadLabel(shown.to, period)
                : dateLabel(shown.to, period)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
