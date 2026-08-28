import type { HistoryRange } from '@svinooh/shared';
import type { DebtTotals, RewardsTotals } from '../lib/blocks';
import { fmtUsd } from '../lib/format';
import { changeOver, type Series } from '../lib/history';
import { AreaChart } from './AreaChart';

/**
 * Two readings the headline total can't give you: what you could collect right
 * now, and what you owe. Each card is the same chart as the one above, drawn
 * edge to edge behind the figure: the period buttons up there drive all three,
 * and the gestures are the same — drag to scroll, shift-drag or two fingers to
 * measure, hover to read a value. The text floats above the chart and lets
 * every pointer through, so the whole card is chart.
 *
 * A line only appears once there is one. Both have only been recorded since the
 * release that started recording them, so a portfolio scanned before that has
 * the figure and no line until its next few syncs land.
 */
export function MetricCards({
  rewards,
  debt,
  claimableSeries,
  debtSeries,
  period,
}: {
  rewards: RewardsTotals;
  debt: DebtTotals;
  claimableSeries: Series;
  debtSeries: Series;
  period: HistoryRange;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, marginTop: 20 }}>
      <Card label="CLAIMABLE" series={claimableSeries} period={period} tone="accent">
        <Figure value={fmtUsd(rewards.total)} accent series={claimableSeries} period={period} />
        <Caption>
          {rewards.pools > 0 || rewards.other > 0
            ? [
                rewards.pools > 0 ? `Pool fees ${fmtUsd(rewards.pools)}` : null,
                rewards.other > 0 ? `Rewards ${fmtUsd(rewards.other)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Nothing accrued yet'}
        </Caption>
      </Card>

      <Card label="TOTAL DEBT" series={debtSeries} period={period} tone="muted">
        <Figure
          value={debt.total > 0 ? fmtUsd(debt.total) : '—'}
          series={debt.total > 0 ? debtSeries : undefined}
          period={period}
          owed
        />
      </Card>

    </div>
  );
}

function Card({
  label,
  series,
  period,
  tone,
  children,
}: {
  label: string;
  series: Series;
  period: HistoryRange;
  tone: 'accent' | 'muted';
  children: React.ReactNode;
}) {
  // Zero all the way across is not a line, it is an axis: a wallet that has
  // never owed anything would get a flat rule drawn under a figure already
  // reading "—". A card earns its chart once there is something in it to see.
  const hasLine = series.values.length >= 2 && series.values.some((v) => v !== 0);
  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid var(--line)',
        borderRadius: 16,
        background: 'var(--surf)',
        overflow: 'hidden',
      }}
    >
      {hasLine ? (
        <div style={{ position: 'absolute', inset: 0 }}>
          <AreaChart values={series.values} times={series.times} period={period} height="100%" bare tone={tone} />
        </div>
      ) : null}
      {/* Above the chart but transparent to it: the text is read, never hit.
          The bottom padding is the lane the line usually runs in — the text
          stays out of it, and a card without a line yet doesn't reserve one */}
      <div style={{ position: 'relative', padding: hasLine ? '18px 20px 64px' : '18px 20px', pointerEvents: 'none' }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--mut)' }}>
          {label}
        </div>
        {children}
      </div>
    </div>
  );
}

function Figure({
  value,
  accent,
  owed,
  series,
  period,
}: {
  value: string;
  accent?: boolean;
  /**
   * A debt reads the other way round: owing more is the bad direction, so the
   * colours are swapped rather than calling a growing debt a gain.
   */
  owed?: boolean;
  series?: Series;
  period: HistoryRange;
}) {
  const change = series ? changeOver(series, period) : null;
  const good = change ? (owed ? !change.up : change.up) : false;

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
      <div
        className="mono"
        style={{
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: '-0.01em',
          color: accent ? 'var(--acc-text)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      {/* The same reading as the one beside the headline total, over the same
          window the period buttons choose */}
      {change ? (
        <div
          className="mono"
          style={{ fontSize: 12, fontWeight: 600, color: good ? 'var(--up)' : 'var(--down)' }}
        >
          {(change.up ? '+' : '−') + fmtUsd(Math.abs(change.chg))} ({change.up ? '+' : '−'}
          {Math.abs(change.pct).toFixed(2)}%)
        </div>
      ) : null}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mut)', marginTop: 7 }}>{children}</div>;
}
