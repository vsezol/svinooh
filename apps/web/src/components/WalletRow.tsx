import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { WalletDto } from '@svinooh/shared';
import { buildBlocks } from '../lib/blocks';
import { chainMeta, fmtUsd, shortAddress, walletName } from '../lib/format';

interface Props {
  wallet: WalletDto;
  isOwner: boolean;
  total: number;
  onRemove: () => void;
  onRename: (label: string) => void;
}

export function WalletRow({ wallet, isOwner, total, onRemove, onRename }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const chain = chainMeta(wallet.chain);
  const label = walletName(wallet.label, wallet.chain);
  const syncing = wallet.status === 'pending' && wallet.totalUsd === null;
  const blocks = useMemo(() => buildBlocks(wallet.positions), [wallet.positions]);
  const expanded = !collapsed && !syncing && blocks.length > 0;
  const share = total > 0 && wallet.totalUsd ? ((wallet.totalUsd / total) * 100).toFixed(1) + '% of total' : '';

  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(wallet.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const remove = (e: MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Remove ${label}? Its history is deleted too.`)) onRemove();
  };

  const startEdit = (e: MouseEvent) => {
    e.stopPropagation();
    setEditValue(wallet.label ?? '');
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const v = editValue.trim();
    if (v !== (wallet.label ?? '')) onRename(v);
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div
        onClick={() => !syncing && setCollapsed((v) => !v)}
        className="row-hover"
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: syncing ? 'default' : 'pointer', userSelect: 'none' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {editing ? (
              <input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={onEditKey}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                spellCheck={false}
                style={{
                  fontFamily: 'var(--sans)',
                  fontWeight: 700,
                  fontSize: 14,
                  color: 'var(--text)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--acc)',
                  outline: 'none',
                  padding: '0 0 1px',
                  width: 140,
                }}
              />
            ) : (
              <>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
                {isOwner && !syncing ? (
                  <span onClick={startEdit} title="Rename" className="wallet-edit">
                    EDIT
                  </span>
                ) : null}
              </>
            )}
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 9.5,
                letterSpacing: '0.08em',
                color: 'var(--mut)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '2px 7px',
              }}
            >
              {chain.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span className="mono" style={{ fontSize: 11.5, color: wallet.status === 'failed' ? 'var(--down)' : 'var(--mut)' }}>
              {wallet.status === 'failed'
                ? 'sync failed'
                : wallet.stale
                  ? `stale · ${shortAddress(wallet.address)}`
                  : shortAddress(wallet.address)}
            </span>
            <span onClick={copy} className="mono copy-link" style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--mut)', cursor: 'pointer' }}>
              {copied ? 'COPIED' : 'COPY'}
            </span>
          </div>
        </div>

        {syncing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span className="spin" style={{ width: 14, height: 14 }} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--mut)' }}>
              syncing…
            </span>
          </div>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontWeight: 600, fontSize: 15 }}>
              {fmtUsd(wallet.totalUsd)}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 2 }}>
              {share}
            </div>
          </div>
        )}

        {isOwner && !syncing ? (
          <div onClick={remove} title="Remove wallet" className="wallet-x">
            ×
          </div>
        ) : null}

        {!syncing && blocks.length > 0 ? (
          <span
            style={{
              width: 8,
              height: 8,
              borderRight: '1.5px solid var(--mut)',
              borderBottom: '1.5px solid var(--mut)',
              transform: expanded ? 'rotate(225deg) translate(-2px,-2px)' : 'rotate(45deg)',
              transition: 'transform 0.18s ease',
              flexShrink: 0,
              marginLeft: 2,
            }}
          />
        ) : null}
      </div>

      {expanded ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {blocks.map((b, i) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surf2)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: 12.5 }}>{b.proto}</span>
                {b.typeLabel ? (
                  <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)' }}>
                    {b.typeLabel}
                  </span>
                ) : null}
                {b.meta ? (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '0.04em' }}>
                    {b.meta}
                  </span>
                ) : null}
                <div style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {fmtUsd(b.value)}
                </span>
              </div>
              {b.rows.map((r, ri) => (
                <div key={ri} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 14px', borderTop: '1px solid var(--line)' }}>
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>{r.title}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.sub}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                    {fmtUsd(r.value)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {wallet.unpriced?.length ? (
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', padding: '2px 4px' }}>
              ⚠ {wallet.unpriced.length} asset(s) without a price source — not included in the total
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
