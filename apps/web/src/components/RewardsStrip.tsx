import type { RewardsTotals } from '../lib/blocks';
import { fmtUsd } from '../lib/format';

/**
 * One compact line above the wallets: what has accrued and is sitting there
 * unclaimed, split into pool fees and everything else. It is a view onto money
 * already counted in the total, not an addition to it — hence "available to
 * claim" rather than a second balance.
 */
export function RewardsStrip({ totals }: { totals: RewardsTotals }) {
  if (totals.total <= 0) return null;

  return (
    <div
      className="card"
      style={{
        marginTop: 14,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        flexWrap: 'wrap',
        borderColor: 'color-mix(in srgb, var(--acc) 26%, var(--line))',
      }}
    >
      <span className="eyebrow" style={{ color: 'var(--acc-text)' }}>
        AVAILABLE TO CLAIM
      </span>
      <div style={{ flex: 1 }} />
      <Item label="POOL FEES" value={totals.pools} />
      <Item label="OTHER REWARDS" value={totals.other} />
      <Item label="TOTAL" value={totals.total} accent />
    </div>
  );
}

function Item({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--mut)' }}>
        {label}
      </span>
      <span
        className="mono"
        style={{ fontSize: 12.5, fontWeight: 600, color: accent ? 'var(--up)' : 'var(--text)' }}
      >
        {fmtUsd(value)}
      </span>
    </div>
  );
}
