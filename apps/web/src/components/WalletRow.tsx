import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { PositionTokenRole, WalletDto } from '@svinooh/shared';
import { blockMatches, buildBlocks, type PositionFilter } from '../lib/blocks';
import { chainMeta, fmtUsd, shortAddress, walletName } from '../lib/format';
import { WalletMenu } from './WalletMenu';
import { TronResources } from './TronResources';

/** What accrued is worth reading as a gain, what is owed as a cost */
const roleColor = (role: PositionTokenRole): string =>
  role === 'reward' ? 'var(--up)' : role === 'borrow' ? 'var(--down)' : 'var(--mut)';

/** 0.8075 → "80.8% APY" */
const fmtApy = (apy: number): string => `${(apy * 100).toFixed(apy < 0.1 ? 2 : 1)}% APY`;

/**
 * edit   — the owner: rename and remove do what they say
 * locked — a portfolio nobody owns: the actions are there, and pressing one
 *          asks you to sign in first
 * none   — somebody else's portfolio: no actions, and no false promise that
 *          signing in would grant any
 */
export type WalletActions = 'edit' | 'locked' | 'none';

interface Props {
  wallet: WalletDto;
  actions: WalletActions;
  total: number;
  /** Which positions to show; blocks that don't match are hidden */
  filter: PositionFilter;
  onRemove: () => void;
  onRename: (label: string) => void;
  /** Pressing a locked action */
  onRequireAuth: () => void;
}

export function WalletRow({ wallet, actions, total, filter, onRemove, onRename, onRequireAuth }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const chain = chainMeta(wallet.chain);
  const label = walletName(wallet.label, wallet.chain);
  const syncing = wallet.status === 'pending' && wallet.totalUsd === null;
  const blocks = useMemo(
    () => buildBlocks(wallet.positions).filter((b) => blockMatches(b, filter)),
    [wallet.positions, filter],
  );
  // Resources are not a position and not money, so they show only on the
  // unfiltered view — a "pools" filter asked about pools
  const tron = filter === 'all' ? (wallet.tron ?? null) : null;
  const expanded = !collapsed && !syncing && (blocks.length > 0 || tron !== null);
  const share = total > 0 && wallet.totalUsd ? ((wallet.totalUsd / total) * 100).toFixed(1) + '% of total' : '';

  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(wallet.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const remove = () => {
    if (confirm(`Remove ${label}? Its history is deleted too.`)) onRemove();
  };

  const startEdit = () => {
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
          {/* The name gives way, never the line: a long label ellipsizes and
              the chain chip stays beside it, rather than wrapping under */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </span>
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
                flexShrink: 0,
              }}
            >
              {chain.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 500, color: wallet.status === 'failed' ? 'var(--down)' : 'var(--mut)' }}>
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
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="mono" style={{ fontWeight: 600, fontSize: 15.5 }}>
              {fmtUsd(wallet.totalUsd)}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 2 }}>
              {share}
            </div>
          </div>
        )}

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

        {/* Actions live behind the kebab, away from the expand chevron */}
        {actions !== 'none' && !syncing ? (
          <WalletMenu
            locked={actions === 'locked'}
            onRename={actions === 'edit' ? startEdit : onRequireAuth}
            onRemove={actions === 'edit' ? remove : onRequireAuth}
          />
        ) : null}
      </div>

      {expanded ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tron ? <TronResources tron={tron} /> : null}
          {blocks.map((b, i) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surf2)', overflow: 'hidden' }}>
              {/* Two lines with fixed jobs, instead of one line that wraps
                  wherever it runs out: the name and the money hold the first
                  line — the money never leaves the right edge — and everything
                  descriptive sits underneath, free to wrap among itself. */}
              <div style={{ padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: 13,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b.proto}
                  </span>
                  {b.count > 1 ? (
                    <span className="mono" title={`${b.count} positions folded together`} style={{ fontSize: 9.5, color: 'var(--mut)', flexShrink: 0 }}>
                      ×{b.count}
                    </span>
                  ) : null}
                  {b.typeLabel ? (
                    <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)', flexShrink: 0 }}>
                      {b.typeLabel}
                    </span>
                  ) : null}
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {fmtUsd(b.value)}
                  </span>
                </div>
                {b.range || b.meta || b.apy != null || b.healthRate != null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 3, marginTop: 5 }}>
                    {b.range ? (
                      <span
                        className="mono"
                        title={
                          b.range === 'in'
                            ? 'The price is inside the position range — it is earning fees'
                            : 'The price has left the position range — it sits in one token and earns nothing'
                        }
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.1em',
                          color: b.range === 'in' ? 'var(--up)' : 'var(--down)',
                          border: `1px solid ${b.range === 'in' ? 'var(--up)' : 'var(--down)'}`,
                          borderRadius: 5,
                          padding: '1px 5px',
                        }}
                      >
                        {b.range === 'in' ? 'IN RANGE' : 'OUT OF RANGE'}
                      </span>
                    ) : null}
                    {b.meta ? (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '0.04em' }}>
                        {b.meta}
                      </span>
                    ) : null}
                    {b.apy != null ? (
                      <span className="mono" style={{ fontSize: 10, color: b.apy >= 0 ? 'var(--up)' : 'var(--down)', letterSpacing: '0.04em' }}>
                        {fmtApy(b.apy)}
                      </span>
                    ) : null}
                    {b.healthRate != null ? (
                      <span
                        className="mono"
                        title="Health factor — below 1 the position is liquidated"
                        style={{ fontSize: 10, color: b.healthRate < 1.5 ? 'var(--down)' : 'var(--mut)', letterSpacing: '0.04em' }}
                      >
                        HF {b.healthRate.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {b.rows.map((r, ri) => (
                // One line that never breaks: the money keeps the right edge
                // whole, and it is the words that give — a long token name
                // ellipsizes, then the amount-times-price detail does
                r.isGroupHead ? (
                  // The label once, with what the group comes to. Muted like a
                  // column heading — it names the lines below it rather than
                  // competing with them; only the figure takes the group's colour.
                  <div
                    key={ri}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      padding: '9px 14px 5px',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--mut)' }}>
                      {r.title}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span
                      className="mono"
                      style={{ fontSize: 11.5, fontWeight: 600, color: r.role ? roleColor(r.role) : undefined }}
                    >
                      {r.role === 'borrow' ? '\u2212' : ''}
                      {fmtUsd(r.value)}
                    </span>
                  </div>
                ) : (
                  // A leg. Indented under its group and without a rule above it,
                  // so the group reads as one thing; a plain holding keeps both.
                  <div
                    key={ri}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      padding: r.indented ? '6px 14px 6px 26px' : '9px 14px',
                      borderTop: r.indented ? 'none' : '1px solid var(--line)',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.title}
                    </span>
                    <span
                      className="mono"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        color: 'var(--mut)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.sub}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        color: r.role && r.role !== 'supply' ? roleColor(r.role) : undefined,
                      }}
                    >
                      {r.role === 'borrow' ? '\u2212' : ''}
                      {fmtUsd(r.value)}
                    </span>
                  </div>
                )
              ))}
            </div>
          ))}
          {wallet.unpriced?.length ? (
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', padding: '2px 4px' }}>
              {wallet.unpriced.length} asset(s) without a price source — not included in the total
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
