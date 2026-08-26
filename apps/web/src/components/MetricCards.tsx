import type { DebtTotals, RewardsTotals, StableSplit } from '../lib/blocks';
import { fmtUsd } from '../lib/format';

/**
 * Three readings of the same portfolio that the headline total can't give you:
 * what you could collect, what you owe and at what price, and how much of it is
 * sitting in dollars.
 */
export function MetricCards({
  rewards,
  debt,
  stables,
}: {
  rewards: RewardsTotals;
  debt: DebtTotals;
  stables: StableSplit;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 22 }}>
      <Card label="CLAIMABLE">
        <Figure value={fmtUsd(rewards.total)} accent />
        <Caption>Fees + staking rewards</Caption>
      </Card>

      <Card label="TOTAL DEBT">
        <Figure value={debt.total > 0 ? fmtUsd(debt.total) : '—'} />
        <Caption>{debtCaption(debt)}</Caption>
      </Card>

      <Card label="STABLES / REST">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
          <span className="mono" style={{ fontWeight: 600, fontSize: 24, letterSpacing: '-0.01em' }}>
            {fmtUsd(stables.stables, 0)}
          </span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--mut)' }}>
            {fmtUsd(stables.rest, 0)}
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 99, background: 'var(--line2)', marginTop: 10, overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.round(stables.stableShare * 100)}%`,
              height: '100%',
              background: 'var(--acc)',
              borderRadius: 99,
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, color: 'var(--mut)', marginTop: 6 }}>
          <span>Stablecoins {Math.round(stables.stableShare * 100)}%</span>
          <span>Rest {Math.round((1 - stables.stableShare) * 100)}%</span>
        </div>
      </Card>
    </div>
  );
}

/**
 * The rate is weighted over the debt whose rate we know. When that isn't all of
 * it, the caption says how much it covers rather than implying the whole.
 */
function debtCaption(debt: DebtTotals): string {
  if (debt.total <= 0) return 'Nothing borrowed';
  if (debt.avgApy == null) return 'Borrow APY not reported by the source';
  const rate = `Avg borrow APY ${(debt.avgApy * 100).toFixed(2)}%`;
  return debt.ratedShare >= 0.995 ? rate : `${rate} · on ${Math.round(debt.ratedShare * 100)}% of debt`;
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
