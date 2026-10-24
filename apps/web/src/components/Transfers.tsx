'use client';

import { useEffect, useState } from 'react';
import type { TransferDto, TransfersDto, WalletDto } from '@svinooh/shared';
import { Card, Eyebrow, Spinner } from '../ui';
import { api } from '../lib/api';
import { fmtAmount, fmtUsd, shortAddress } from '../lib/format';
import { networkName } from './ChainBadge';

/**
 * Deposits and withdrawals: plain transfers between the portfolio's wallets and
 * addresses it does not hold. Swaps, protocol deposits and moves between its
 * own wallets are left out — that money never left.
 */
export function Transfers({ slug, wallets }: { slug: string; wallets: WalletDto[] }) {
  const [data, setData] = useState<TransfersDto | null>(null);
  const [failed, setFailed] = useState(false);
  const walletKey = wallets.map((w) => w.id).join(',');

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api<TransfersDto>(`/portfolios/${slug}/transfers`)
      .then((answer) => !cancelled && setData(answer))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [slug, walletKey]);

  if (failed) return <Empty title="Could not load transfers" note="Try again in a minute." />;
  if (!data) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <Spinner size={20} />
      </div>
    );
  }

  const byId = new Map(wallets.map((w) => [w.id, w]));
  const unread = data.unread.map((id) => byId.get(id)).filter((w): w is WalletDto => Boolean(w));

  return (
    <div>
      {unread.length ? (
        <div className="mono" style={{ marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
          Could not read {unread.map(walletTitle).join(', ')} — not in the list.
        </div>
      ) : null}

      {data.transfers.length === 0 ? (
        <Empty
          title="No deposits or withdrawals"
          note="Nothing moved between this portfolio and the outside lately. Swaps, protocol deposits, moves between its own wallets and anything under $1 are not listed."
        />
      ) : (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {data.transfers.map((transfer) => (
            <Row
              key={`${transfer.walletId}-${transfer.txHash}-${transfer.direction}`}
              transfer={transfer}
              wallet={byId.get(transfer.walletId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The owner's label (the api sends it to the owner alone), or the address */
const walletTitle = (wallet: WalletDto): string => wallet.label || shortAddress(wallet.address);

function Row({ transfer, wallet }: { transfer: TransferDto; wallet: WalletDto | undefined }) {
  const inbound = transfer.direction === 'in';
  const other = transfer.counterparty ? shortAddress(transfer.counterparty) : null;
  const network =
    networkName(transfer.network) ?? (transfer.chain === 'BTC' ? 'Bitcoin' : transfer.chain === 'TRON' ? 'Tron' : transfer.chain);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        padding: '13px 2px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <Arrow inbound={inbound} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ph-mask: an amount is money — session replay stores asterisks */}
        <div className="mono ph-mask" style={{ ...ellipsis, fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)' }}>
          {transfer.legs.map((leg) => `${fmtAmount(leg.amount)} ${leg.symbol}`).join(' + ')}
        </div>
        <div style={{ ...ellipsis, fontSize: 'var(--fs-note)' }}>
          {inbound ? 'Deposit' : 'Withdrawal'}
          {other ? <span className="mono" style={{ color: 'var(--mut)' }}> {inbound ? 'from' : 'to'} {other}</span> : null}
        </div>
        {/* ph-mask: a wallet label is the owner's own words */}
        <div className="mono ph-mask" style={{ ...ellipsis, fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
          {[when(transfer.t), wallet ? walletTitle(wallet) : null, network].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div
          className="mono ph-mask"
          style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)', color: inbound ? 'var(--up)' : 'var(--down)' }}
        >
          {(inbound ? '+' : '−') + fmtUsd(transfer.usd)}
        </div>
        <a
          className="mono"
          href={explorerUrl(transfer)}
          target="_blank"
          rel="noreferrer noopener"
          style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}
        >
          {shortAddress(transfer.txHash)}
        </a>
      </div>
    </div>
  );
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function explorerUrl({ chain, txHash }: TransferDto): string {
  if (chain === 'BTC') return `https://mempool.space/tx/${txHash}`;
  if (chain === 'TRON') return `https://tronscan.org/#/transaction/${txHash}`;
  if (chain === 'SOL') return `https://solscan.io/tx/${txHash}`;
  // One EVM address spans a dozen networks; blockscan finds the one the hash is on
  return `https://blockscan.com/tx/${txHash}`;
}

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
    <Card style={{ padding: '40px 20px', textAlign: 'center' }}>
      <Eyebrow>{title}</Eyebrow>
      <div style={{ marginTop: 8, fontSize: 'var(--fs-note)', color: 'var(--mut)', lineHeight: 1.55 }}>{note}</div>
    </Card>
  );
}
