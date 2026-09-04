'use client';

import type { TronResourcesDto } from '@svinooh/shared';
import { Meter, Row } from '../ui';

/**
 * What a Tron wallet can spend, and what it has lent out.
 *
 * Tron charges in resources rather than in TRX: energy runs contract calls,
 * bandwidth pays for a transaction's bytes, and both regenerate. Staked TRX can
 * be delegated to another account, which locks and later unlocks — and that
 * unlock is the one thing here somebody acts on, so it keeps a line of its own.
 *
 * None of it is money, which is why it sits apart from the position blocks
 * instead of among them: adding it to the total would be wrong, and leaving it
 * off the page loses the reason the wallet is staked in the first place.
 */

const count = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '?';

const trx = (n: number): string =>
  Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString('en-US') : '?';

/** One resource: the name, what is left of what there is, and the same as a bar */
function Resource({ name, free, total }: { name: string; free: number; total: number }) {
  const share = total > 0 ? Math.max(0, Math.min(1, free / total)) : 0;
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      <Row label={name}>
        <span className="mono" style={{ whiteSpace: 'nowrap' }}>
          {count(free)}
          <span style={{ color: 'var(--mut)' }}> / {count(total)}</span>
        </span>
      </Row>
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <Meter value={share} />
      </div>
    </div>
  );
}

/** What goes to the right of UNLOCKS: "Sep 5 · in 12 days", or that the wait is over */
function reclaimLine(tron: TronResourcesDto): string {
  if (tron.reclaimableNow) return 'Now · reclaimable';
  if (!tron.nextReclaimAt) return 'Locked';
  const at = Date.parse(tron.nextReclaimAt);
  if (Number.isNaN(at)) return 'Locked';
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  const date = new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return days <= 0 ? date : `${date} · in ${days} day${days === 1 ? '' : 's'}`;
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
        borderRadius: 'var(--r-md)',
        background: 'var(--surf2)',
        padding: 'var(--sp-5) 14px',
      }}
    >
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <Resource name="ENERGY" free={tron.energyFree} total={energyTotal} />
        <Resource name="BANDWIDTH" free={tron.bandwidthFree} total={bandwidthTotal} />
      </div>

      {/* A wallet with nothing lent out gets no lines saying so — the card is
          about what is there. What it does have reads like the meters above:
          the label on the left, the answer on the right, one fact per line. */}
      {tron.hasDelegation ? (
        <div
          style={{
            marginTop: 11,
            paddingTop: 'var(--sp-4)',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-3)',
          }}
        >
          <Row label="DELEGATED OUT">{delegated.length ? delegated.join(' · ') : 'Yes'}</Row>
          <Row label="UNLOCKS">
            <span
              style={{
                color: tron.reclaimableNow ? 'var(--acc)' : undefined,
                fontWeight: tron.reclaimableNow ? 'var(--fw-bold)' : undefined,
              }}
            >
              {reclaimLine(tron)}
            </span>
          </Row>
        </div>
      ) : null}
    </div>
  );
}
