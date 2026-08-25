import type { RewardsTotals } from '../lib/blocks';
import { fmtUsd } from '../lib/format';

/**
 * What has accrued and is sitting there unclaimed. Two lines rather than one
 * long row: the total is the number people look for, the split is context. A
 * single row of five labels and figures wraps into mush on a phone.
 *
 * It is a view onto money already counted in the total, not an addition to it —
 * hence "claimable" rather than a second balance.
 */
export function RewardsStrip({ totals }: { totals: RewardsTotals }) {
  if (totals.total <= 0) return null;

  const parts = [
    totals.pools > 0 ? `pool fees ${fmtUsd(totals.pools)}` : null,
    totals.other > 0 ? `rewards ${fmtUsd(totals.other)}` : null,
  ].filter(Boolean);

  return (
    <div
      className="card"
      style={{
        marginTop: 14,
        padding: '10px 14px',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 2,
        borderColor: 'color-mix(in srgb, var(--acc) 26%, var(--line))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="eyebrow" style={{ color: 'var(--acc-text)' }}>
          CLAIMABLE
        </span>
        <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--up)' }}>
          {fmtUsd(totals.total)}
        </span>
      </div>
      {/* Only shown when the split says something the total doesn't */}
      {parts.length > 1 ? (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--mut)' }}>
          {parts.join(' · ')}
        </div>
      ) : null}
    </div>
  );
}
