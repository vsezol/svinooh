import type { HistoryRange } from '@svinooh/shared';
import type { DebtTotals, RewardsTotals } from '../lib/blocks';
import { fmtUsd } from '../lib/format';
import type { Series } from '../lib/history';
import { AreaChart } from './AreaChart';

/**
 * Two readings the headline total can't give you: what you could collect right
 * now, and what you owe — each over the same window as the chart above them,
 * and read the same way: drag to move, shift-drag or two fingers to measure.
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 22 }}>
      <Card label="CLAIMABLE" series={claimableSeries} period={period}>
        <Figure value={fmtUsd(rewards.total)} accent />
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

      <Card label="TOTAL DEBT" series={debtSeries} period={period}>
        <Figure value={debt.total > 0 ? fmtUsd(debt.total) : '—'} />
      </Card>

    </div>
  );
}

function Card({
  label,
  series,
  period,
  children,
}: {
  label: string;
  series: Series;
  period: HistoryRange;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 16,
        background: 'var(--surf)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--mut)' }}>
        {label}
      </div>
      {children}
      {series.values.length >= 2 ? (
        // Pushed to the bottom so two cards of different heights still line
        // their charts up with each other
        <div style={{ marginTop: 'auto', paddingTop: 12, marginLeft: -6, marginRight: -6 }}>
          <AreaChart values={series.values} times={series.times} period={period} height="52px" bare />
        </div>
      ) : null}
    </div>
  );
}

function Figure({ value, accent }: { value: string; accent?: boolean }) {
  return (
    <div
      className="mono"
      style={{
        fontWeight: 600,
        fontSize: 24,
        letterSpacing: '-0.01em',
        marginTop: 8,
        color: accent ? 'var(--acc-text)' : 'var(--text)',
      }}
    >
      {value}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mut)', marginTop: 5 }}>{children}</div>;
}
