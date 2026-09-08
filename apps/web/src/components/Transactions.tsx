'use client';

import type { FlowDto, HistoryRange } from '@svinooh/shared';
import { Eyebrow, Spinner } from '../ui';
import { fmtUsd } from '../lib/format';
import { explorerUrl, legLabel } from '../lib/flows';
import { networkName } from './ChainBadge';

/**
 * The money that came in and went out, under the chart it corrects.
 *
 * Only what crossed the portfolio's edge, which is what makes it short enough
 * to read: a wallet doing anything at all produces hundreds of transactions a
 * month, and this is the handful that changed how much money is in the
 * portfolio rather than what form it is in. A swap is not here; a transfer to
 * an exchange is.
 *
 * Every figure is the value AT THE TIME — the price on the day, not today's.
 * That is the point of the column, and the reason the amounts are shown beside
 * it: $5,000 of ETH two months ago is a different amount of ETH than it is now.
 */
export function Transactions({
  flows,
  from,
  period,
  loading,
  /** Label per wallet id, so a flow can say which of them it moved through */
  labels,
}: {
  flows: FlowDto[];
  from: string | null;
  period: HistoryRange;
  loading: boolean;
  labels: Map<string, string>;
}) {
  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <Spinner size={20} />
      </div>
    );
  }

  if (!from) {
    return (
      <Empty
        title="Nothing read yet"
        note="Transfers for this portfolio's wallets have not been collected. They arrive within an hour of a wallet being added."
      />
    );
  }

  if (!flows.length) {
    return (
      <Empty
        title="No deposits or withdrawals"
        note={`Nothing crossed this portfolio's edge in the last ${period.toUpperCase()}. Swaps, moves between your own wallets and deposits into a protocol are not listed — the value never left.`}
      />
    );
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div
        className="mono"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) auto',
          gap: 'var(--sp-3)',
          padding: '0 2px 8px',
          fontSize: 'var(--fs-micro)',
          letterSpacing: '0.16em',
          color: 'var(--mut)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span>MOVED</span>
        <span>WHERE</span>
        <span style={{ textAlign: 'right' }}>VALUE THEN</span>
      </div>

      {flows.map((flow) => (
        <Row key={`${flow.txHash}-${flow.direction}-${flow.t}`} flow={flow} labels={labels} />
      ))}
    </div>
  );
}

function Row({ flow, labels }: { flow: FlowDto; labels: Map<string, string> }) {
  const inbound = flow.direction === 'in';
  const colour = inbound ? 'var(--up)' : 'var(--down)';
  const href = explorerUrl(flow);
  const where =
    networkName(flow.network) ??
    (flow.chain === 'BTC' ? 'Bitcoin' : flow.chain === 'TRON' ? 'Tron' : flow.chain);
  const wallet = flow.walletId ? labels.get(flow.walletId) : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) auto',
        gap: 'var(--sp-3)',
        alignItems: 'center',
        padding: '13px 2px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <Arrow inbound={inbound} />
        <div style={{ minWidth: 0 }}>
          {/* ph-mask: an amount is money — session replay stores asterisks */}
          <div
            className="mono ph-mask"
            style={{
              fontWeight: 'var(--fw-medium)',
              fontSize: 'var(--fs-body)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {flow.legs.map(legLabel).join(' + ')}
          </div>
          <div className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
            {new Date(flow.t).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </div>
        </div>
      </div>

      <div style={{ minWidth: 0, fontSize: 'var(--fs-note)' }}>
        <div style={{ color: 'var(--text)' }}>{where}</div>
        {/* ph-mask: a wallet label is the owner's own words */}
        {wallet ? (
          <div
            className="ph-mask"
            style={{
              color: 'var(--mut)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {wallet}
          </div>
        ) : null}
      </div>

      <div style={{ textAlign: 'right' }}>
        <div
          className="mono ph-mask"
          style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)', color: colour }}
        >
          {/* An unpriced move is shown as one rather than as $0: nobody could
              say what it was worth, and zero is a claim that it was worthless */}
          {flow.usd === null ? '—' : (inbound ? '+' : '−') + fmtUsd(flow.usd, 0)}
        </div>
        {href ? (
          <a
            className="mono"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}
          >
            {flow.txHash.slice(0, 6)}…{flow.txHash.slice(-4)}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** In or out, as the one thing the eye should find scanning down the list */
function Arrow({ inbound }: { inbound: boolean }) {
  const colour = inbound ? 'var(--up)' : 'var(--down)';
  return (
    <span
      style={{
        flexShrink: 0,
        width: 26,
        height: 26,
        borderRadius: 'var(--r-full)',
        display: 'grid',
        placeItems: 'center',
        background: `color-mix(in srgb, ${colour} 14%, transparent)`,
        color: colour,
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {inbound ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />}
      </svg>
    </span>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ padding: '44px 8px', textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
      <Eyebrow>{title}</Eyebrow>
      <div style={{ marginTop: 8, fontSize: 'var(--fs-note)', color: 'var(--mut)', lineHeight: 1.55 }}>
        {note}
      </div>
    </div>
  );
}
