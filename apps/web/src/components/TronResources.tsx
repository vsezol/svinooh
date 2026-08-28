'use client';

import type { CSSProperties } from 'react';
import type { TronResourcesDto } from '@svinooh/shared';

/**
 * What a Tron wallet can spend, and what it has lent out — one strip, two rows
 * at most.
 *
 * Tron charges in resources rather than in TRX: energy runs contract calls,
 * bandwidth pays for a transaction's bytes, and both regenerate. Staked TRX can
 * be delegated to another account, which locks and later unlocks — and that
 * unlock is the one thing here somebody acts on, so it stays on its own line.
 *
 * None of it is money, which is why it sits apart from the position blocks
 * instead of among them: adding it to the total would be wrong, and leaving it
 * off the page loses the reason the wallet is staked in the first place.
 */

const LABEL: CSSProperties = { fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)' };

const count = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '?';

const trx = (n: number): string =>
  Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString('en-US') : '?';

/** One resource on one line: name, what is left of what there is, and a bar */
function Meter({ name, free, total }: { name: string; free: number; total: number }) {
  const share = total > 0 ? Math.max(0, Math.min(1, free / total)) : 0;
  return (
    <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="mono" style={LABEL}>
        {name}
      </span>
      <span className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {count(free)}
        <span style={{ color: 'var(--mut)' }}> / {count(total)}</span>
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 36,
          height: 4,
          borderRadius: 999,
          background: 'var(--line2)',
          overflow: 'hidden',
        }}
      >
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
  // The node's limit is what the wallet can spend ITSELF, and delegating hands
  // the allowance to the delegatee — so a wallet that has lent out its whole
  // stake reads "0 / 0", as if staking bought nothing. The total shown here is
  // the stake's whole earning, own limit plus what is currently lent out, and
  // the empty bar is then the true picture: it exists, and none of it is here.
  const energyTotal = tron.energyTotal + tron.delegatedEnergy;
  const bandwidthTotal = tron.bandwidthTotal + tron.delegatedBandwidth;

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
        padding: '8px 14px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 18,
        rowGap: 6,
      }}
    >
      <Meter name="ENERGY" free={tron.energyFree} total={energyTotal} />
      <Meter name="BANDWIDTH" free={tron.bandwidthFree} total={bandwidthTotal} />

      {/* A wallet with nothing lent out gets no line saying so — the strip is
          about what is there */}
      {tron.hasDelegation ? (
        <div
          style={{
            flexBasis: '100%',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: 10,
            rowGap: 2,
            fontSize: 12,
          }}
        >
          <span className="mono" style={LABEL}>
            DELEGATED OUT
          </span>
          <span>{delegated.length ? delegated.join(' · ') : 'Yes'}</span>
          <span
            style={{
              color: tron.reclaimableNow ? 'var(--acc)' : 'var(--mut)',
              fontWeight: tron.reclaimableNow ? 700 : 400,
            }}
          >
            {reclaimLine(tron)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
