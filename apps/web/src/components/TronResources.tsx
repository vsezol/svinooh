'use client';

import type { CSSProperties } from 'react';
import type { TronResourcesDto } from '@svinooh/shared';

/**
 * What a Tron wallet can spend, and what it has lent out.
 *
 * Tron charges in resources rather than in TRX: energy runs contract calls,
 * bandwidth pays for a transaction's bytes, and both regenerate. Staked TRX can
 * be delegated to another account, which locks and later unlocks — and that
 * unlock is the one thing here somebody acts on, so it gets a line of its own
 * rather than being left to be worked out from a date.
 *
 * None of it is money, which is why it sits apart from the position blocks
 * instead of among them: adding it to the total would be wrong, and leaving it
 * off the page loses the reason the wallet is staked in the first place.
 */

const BAR_BG: CSSProperties = {
  height: 4,
  borderRadius: 999,
  background: 'var(--line2)',
  overflow: 'hidden',
  marginTop: 6,
};

const count = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '?';

const trx = (n: number): string =>
  Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString('en-US') : '?';

/** One resource: what is left of what there is, and the same as a bar */
function Meter({ icon, name, free, total }: { icon: string; name: string; free: number; total: number }) {
  // A wallet that has never staked has no allowance at all — a bar of zero over
  // zero would read as "empty" when the truth is "none of this yet"
  const share = total > 0 ? Math.max(0, Math.min(1, free / total)) : 0;
  return (
    <div style={{ flex: 1, minWidth: 132 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 12 }}>{icon}</span>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)' }}>
          {name}
        </span>
      </div>
      <div className="mono" style={{ fontSize: 12.5, marginTop: 3 }}>
        {count(free)}
        <span style={{ color: 'var(--mut)' }}> / {count(total)}</span>
      </div>
      <div style={BAR_BG}>
        <div
          style={{
            width: `${share * 100}%`,
            height: '100%',
            background: 'var(--acc)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

/** "in 12 days", or the plain fact that the wait is over */
function reclaimLine(tron: TronResourcesDto): string {
  if (tron.reclaimableNow) return 'Reclaimable now';
  if (!tron.nextReclaimAt) return 'Locked';
  const at = Date.parse(tron.nextReclaimAt);
  if (Number.isNaN(at)) return 'Locked';
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  const date = new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return days <= 0 ? `Unlocks ${date}` : `Unlocks ${date} · in ${days} day${days === 1 ? '' : 's'}`;
}

export function TronResources({ tron }: { tron: TronResourcesDto }) {
  const delegated: string[] = [];
  if (tron.delegatedEnergy > 0) {
    delegated.push(`${count(tron.delegatedEnergy)} energy · ${trx(tron.delegatedEnergyTrx)} TRX`);
  }
  if (tron.delegatedBandwidth > 0) {
    delegated.push(`${count(tron.delegatedBandwidth)} bandwidth · ${trx(tron.delegatedBandwidthTrx)} TRX`);
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--surf2)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>Resources</span>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)' }}>
          ENERGY &amp; BANDWIDTH
        </span>
      </div>

      <div style={{ display: 'flex', gap: 18, padding: '0 14px 12px', flexWrap: 'wrap' }}>
        <Meter icon="⚡" name="ENERGY" free={tron.energyFree} total={tron.energyTotal} />
        <Meter icon="📶" name="BANDWIDTH" free={tron.bandwidthFree} total={tron.bandwidthTotal} />
      </div>

      {tron.hasDelegation ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: '10px 14px' }}>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)' }}>
            DELEGATED OUT
          </div>
          <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>
            {delegated.length ? delegated.join(' · ') : 'Yes'}
          </div>
          <div
            style={{
              fontSize: 12,
              marginTop: 4,
              color: tron.reclaimableNow ? 'var(--acc)' : 'var(--mut)',
              fontWeight: tron.reclaimableNow ? 700 : 400,
            }}
          >
            {reclaimLine(tron)}
          </div>
        </div>
      ) : (
        <div
          style={{
            borderTop: '1px solid var(--line)',
            padding: '10px 14px',
            fontSize: 12.5,
            color: 'var(--mut)',
          }}
        >
          Nothing delegated out
        </div>
      )}
    </div>
  );
}
