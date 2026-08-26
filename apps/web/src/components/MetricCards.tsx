import type { DebtTotals, RewardsTotals } from '../lib/blocks';
import { fmtUsd } from '../lib/format';

/**
 * Two readings the headline total can't give you: what you could collect right
 * now, and what you owe.
 */
export function MetricCards({ rewards, debt }: { rewards: RewardsTotals; debt: DebtTotals }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 22 }}>
      <Card label="CLAIMABLE">
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

      <Card label="TOTAL DEBT">
        <Figure value={debt.total > 0 ? fmtUsd(debt.total) : '—'} />
      </Card>

    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surf)', padding: '16px 18px' }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--mut)' }}>
        {label}
      </div>
      {children}
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
