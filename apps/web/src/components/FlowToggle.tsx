'use client';

import type { PerformanceBasis } from '@svinooh/shared';
import { InfoTip, Switch, Tag } from '../ui';

/**
 * The experimental switch beside the period buttons: whether to read the chart
 * with deposits and withdrawals netted off.
 *
 * Why it is a switch and not a third period button: it does not change WHAT is
 * on screen, it changes what the same window is claiming. Two things measured
 * over the same day, and the reader picks which question they are asking.
 *
 * The tooltip is long on purpose. This is a number about somebody's money that
 * disagrees with the number beside it, and the reasons it can be wrong are
 * knowable — a venue we cannot see, a bridge, an airdrop. Hiding them behind
 * "experimental" would be a worse experiment.
 */
export function FlowToggle({
  basis,
  onChange,
  /**
   * When transfer coverage starts. Never null in practice — the page does not
   * render this at all until every wallet in scope has been read, because a
   * switch that cannot change anything is worse than no switch.
   */
  from,
}: {
  basis: PerformanceBasis;
  onChange: (basis: PerformanceBasis) => void;
  from: string | null;
}) {
  const since = from
    ? new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
      <Switch
        on={basis === 'net-flows'}
        onChange={(on) => onChange(on ? 'net-flows' : 'raw')}
        label="Account for deposits and withdrawals"
      />
      <span
        style={{
          fontSize: 'var(--fs-note)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
          whiteSpace: 'nowrap',
        }}
      >
        Account for deposits &amp; withdrawals
      </span>
      <Tag variant="soft" size="sm">
        EXPERIMENTAL
      </Tag>
      <InfoTip
        label="What accounting for deposits and withdrawals does"
        text={
          <>
            <p style={{ margin: '0 0 8px' }}>
              Money you move in or out is not a profit or a loss. Withdraw $5,000 from $100,000 and
              the balance falls 5% — this takes that step out, so the chart and the figure show what
              your holdings did.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Swaps, moves between your own wallets, and deposits into a protocol are not counted:
              the value never left. Claimed rewards and airdrops are counted as gains, not as money
              you put in.
            </p>
            <p style={{ margin: 0 }}>
              {since
                ? `Transfers are read from ${since}; the corrected line starts there. `
                : 'Transfers have not been read for this portfolio yet. '}
              It can still be wrong: money moved into a venue we cannot read looks like a
              withdrawal, and a slow bridge can look like one too.
            </p>
          </>
        }
      />
    </div>
  );
}
