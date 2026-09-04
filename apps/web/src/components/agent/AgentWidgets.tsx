'use client';

import type { CSSProperties } from 'react';
import type {
  AgentBlock,
  BarsBlock,
  ChartBlock,
  NoteBlock,
  StatsBlock,
  TableBlock,
  TextBlock,
} from '../../lib/agent';
import { AreaChart } from '../AreaChart';
import { WINDOW_MS } from '../../lib/ranges';

/**
 * What the agent can draw.
 *
 * Every widget here takes plain data and nothing else — no style objects, no
 * class names passed in, no slots. That is what makes them worth having: the
 * same components render an answer assembled on this machine today and one that
 * arrives over a wire later, and neither side has to know which it was.
 *
 * They share one card: a hairline, a 14px radius and the surface colour, the
 * same as the metric cards on the portfolio page. An answer is a stack of them,
 * so the spacing lives on the card rather than between them.
 */
const CARD: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surf)',
  marginTop: 12,
  overflow: 'hidden',
};

/** The small upper-case label above a figure — the app's eyebrow, at widget scale */
const EYEBROW: CSSProperties = {
  fontSize: 'var(--fs-micro)',
  letterSpacing: '0.14em',
  color: 'var(--mut)',
};

const toneColor = (tone: string | undefined, fallback = 'var(--mut)'): string =>
  tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : tone === 'accent' ? 'var(--acc)' : fallback;

export function AgentBlockView({ block }: { block: AgentBlock }) {
  switch (block.kind) {
    case 'text':
      return <AgentText block={block} />;
    case 'stats':
      return <AgentStats block={block} />;
    case 'chart':
      return <AgentChartCard block={block} />;
    case 'table':
      return <AgentTable block={block} />;
    case 'bars':
      return <AgentBars block={block} />;
    case 'note':
      return <AgentNote block={block} />;
  }
}

/** The agent's own voice. Everything else on this page is a number. */
export function AgentText({ block }: { block: TextBlock }) {
  return (
    <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.7, color: 'var(--text)', textWrap: 'pretty' }}>
      {block.text}
    </div>
  );
}

/**
 * A row of readings that fits whatever width it is given: as many across as
 * will hold 122px, then the next line. Three is the common case and lands as
 * three on a desktop and two-then-one on a phone.
 */
export function AgentStats({ block }: { block: StatsBlock }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(122px,1fr))',
        gap: 8,
        marginTop: 12,
      }}
    >
      {block.cards.map((card) => (
        <div
          key={card.label}
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surf)',
            padding: '13px 14px',
          }}
        >
          <div className="mono" style={EYEBROW}>
            {card.label}
          </div>
          <div
            className="mono"
            style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-title)', letterSpacing: '-0.01em', marginTop: 7 }}
          >
            {card.value}
          </div>
          {card.note ? (
            <div className="mono" style={{ fontSize: 'var(--fs-tag)', marginTop: 6, color: toneColor(card.tone) }}>
              {card.note}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * A line in an answer, drawn by the app's own chart rather than by a sparkline
 * of its own.
 *
 * `bare` strips the frame and the dates, which the card supplies instead — but
 * everything else the chart does comes with it: drag to scroll back, shift-drag
 * or two fingers to measure a span, hover to read a value. A chart the agent
 * hands you is the same chart you already know how to use.
 */
export function AgentChartCard({ block }: { block: ChartBlock }) {
  const { series } = block;
  // Where the chart opens, not where the data starts. The series reaches back
  // several windows so there is somewhere to scroll to, and naming its first
  // reading would put "Aug 25" under a chart showing the last 24 hours.
  const from = openedAt(series.times, block.period);

  return (
    <div style={CARD}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          padding: '13px 15px 0',
        }}
      >
        <span className="mono" style={EYEBROW}>
          {block.title}
        </span>
        {block.sub ? (
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-note)', fontWeight: 'var(--fw-medium)', color: toneColor(block.subTone, 'var(--text)') }}
          >
            {block.sub}
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 8 }} data-no-swipe="true">
        <AreaChart
          values={series.values}
          times={series.times}
          period={block.period}
          height="120px"
          bare
          tone={block.tone ?? 'accent'}
        />
      </div>
      <div
        className="mono"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 15px 12px',
          fontSize: 'var(--fs-micro)',
          color: 'var(--mut)',
        }}
      >
        <span>{from}</span>
        <span>NOW</span>
      </div>
    </div>
  );
}

/** The left-hand date under a chart: the start of the window it opens on */
function openedAt(times: number[], period: ChartBlock['period']): string {
  if (!times.length) return '';
  const window = WINDOW_MS[period];
  const last = times[times.length - 1];
  const start = window === null ? times[0] : Math.max(times[0], last - window);
  const sameDay = window !== null && window <= 24 * 3600e3;
  return new Date(start).toLocaleString(
    undefined,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' },
  );
}

/** A cell that says "+1.2%" or "−3%" and was given no tone colours itself */
function cellTone(text: string, tone: string | undefined, first: boolean): string | undefined {
  if (tone) return toneColor(tone, 'var(--text)');
  if (first) return 'var(--text)';
  if (text.startsWith('−') || text.startsWith('-')) return 'var(--down)';
  if (text.startsWith('+')) return 'var(--up)';
  return 'var(--text)';
}

/**
 * Names down the left, readings down the right.
 *
 * The name column takes 1.6 of the width the others get and is the only one set
 * ragged-right in the text face; every reading is mono and right-aligned, so a
 * column of them can be read as a column rather than as a list of strings that
 * happen to be numbers.
 */
export function AgentTable({ block }: { block: TableBlock }) {
  const grid = `minmax(0,1.6fr) repeat(${block.columns.length - 1}, minmax(0,1fr))`;
  const cell = (index: number): CSSProperties => ({
    fontFamily: index ? 'var(--mono)' : 'inherit',
    fontWeight: index ? 600 : 700,
    fontSize: index ? 12 : 12.5,
    textAlign: index ? 'right' : 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  return (
    <div style={CARD}>
      <div
        className="mono"
        style={{
          display: 'grid',
          gridTemplateColumns: grid,
          gap: 10,
          padding: '11px 14px 9px',
          ...EYEBROW,
        }}
      >
        {block.columns.map((label, i) => (
          <span key={label} style={{ textAlign: i ? 'right' : 'left' }}>
            {label}
          </span>
        ))}
      </div>
      {block.rows.map((cells, ri) => (
        <div
          key={ri}
          style={{
            display: 'grid',
            gridTemplateColumns: grid,
            gap: 10,
            padding: '11px 14px',
            borderTop: '1px solid var(--line)',
            alignItems: 'baseline',
          }}
        >
          {cells.map((c, i) => (
            <span key={i} style={{ ...cell(i), color: cellTone(c.text, c.tone, i === 0) }}>
              {c.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A reading each, with a bar underneath saying how far along something it is.
 *
 * For the measurements where the number alone does not land — a health factor
 * of 1.27 means nothing until you can see it sitting near the bottom of its
 * bar, next to one at 2.14 that is not.
 */
export function AgentBars({ block }: { block: BarsBlock }) {
  return (
    <div style={CARD}>
      {block.items.map((item, i) => (
        <div
          key={item.label}
          style={{ padding: '13px 15px', borderTop: i ? '1px solid var(--line)' : 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)' }}>{item.label}</span>
            <span
              className="mono"
              style={{ fontSize: 'var(--fs-note)', fontWeight: 'var(--fw-medium)', color: toneColor(item.tone, 'var(--text)') }}
            >
              {item.value}
            </span>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 'var(--r-full)',
              background: 'var(--line2)',
              marginTop: 9,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, item.percent))}%`,
                height: '100%',
                background: toneColor(item.tone, 'var(--acc)'),
                borderRadius: 'var(--r-full)',
              }}
            />
          </div>
          {item.sub ? (
            <div className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', marginTop: 7 }}>
              {item.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The one line worth acting on. Marked down the left edge rather than boxed in
 * a colour, so it reads as emphasis inside the answer instead of as a warning
 * about it.
 */
export function AgentNote({ block }: { block: NoteBlock }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 9,
        marginTop: 12,
        padding: '12px 14px',
        border: '1px solid var(--line)',
        borderLeft: '2px solid var(--acc)',
        borderRadius: '0 14px 14px 0',
        background: 'var(--surf)',
        fontSize: 'var(--fs-body)',
        lineHeight: 1.6,
        color: 'var(--mut)',
      }}
    >
      {block.text}
    </div>
  );
}
