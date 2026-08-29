import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { PositionTokenRole, WalletDto } from '@svinooh/shared';
import { blockMatches, buildBlocks, type BlockSection, type PositionFilter } from '../lib/blocks';
import { chainMeta, fmtAmount, fmtPrice, fmtUsd, shortAddress, walletName } from '../lib/format';
import { ChainBadge } from './ChainBadge';
import { WalletMenu } from './WalletMenu';
import { TronResources } from './TronResources';

/**
 * What a section is drawn in: accrued reads as a gain, owed as a cost, and what
 * is simply held takes no colour at all — most of the table is holdings, and
 * colouring all of it would leave nothing for the colour to mean.
 */
const sectionColor = (section: BlockSection): string | undefined =>
  section.label === null ? undefined : section.negative ? 'var(--down)' : 'var(--up)';

/** The numeric columns: mono, right-aligned, and never wrapping */
const cellStyle = {
  fontSize: 13,
  fontWeight: 500,
  textAlign: 'right' as const,
  color: 'var(--mut)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  minWidth: 0,
};

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
              {/* One line, allowed to wrap among itself: name, what kind of
                  position it is, its detail, and whether it is in range — then
                  the money, held against the right edge. The pieces are all
                  short now that the chain is a mark and the pair is in the
                  table below, so a second line would be a line of air. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', flexWrap: 'wrap' }}>
                <ChainBadge network={b.network} size={18} />
                <span style={{ fontWeight: 800, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.proto}
                </span>
                {b.count > 1 ? (
                  <span className="mono" title={`${b.count} positions folded together`} style={{ fontSize: 9.5, color: 'var(--mut)' }}>
                    ×{b.count}
                  </span>
                ) : null}
                {b.typeLabel ? (
                  <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--mut)' }}>
                    {b.typeLabel}
                  </span>
                ) : null}
                {b.meta ? (
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', letterSpacing: '0.04em' }}>
                    {b.meta}
                  </span>
                ) : null}
                {b.apy != null ? (
                  <span className="mono" style={{ fontSize: 10.5, color: b.apy >= 0 ? 'var(--up)' : 'var(--down)', letterSpacing: '0.04em' }}>
                    {fmtApy(b.apy)}
                  </span>
                ) : null}
                {b.healthRate != null ? (
                  <span
                    className="mono"
                    title="Health factor — below 1 the position is liquidated"
                    style={{ fontSize: 10.5, color: b.healthRate < 1.5 ? 'var(--down)' : 'var(--mut)', letterSpacing: '0.04em' }}
                  >
                    HF {b.healthRate.toFixed(2)}
                  </span>
                ) : null}
                {b.range ? (
                  // Plain coloured text, not a bordered pill: it sits among
                  // other small mono notes and a box around one of them makes
                  // it a button that cannot be pressed
                  <span
                    className="mono"
                    title={
                      b.range === 'in'
                        ? 'The price is inside the position range — it is earning fees'
                        : 'The price has left the position range — it sits in one token and earns nothing'
                    }
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      whiteSpace: 'nowrap',
                      fontWeight: 600,
                      color: b.range === 'in' ? 'var(--up)' : 'var(--down)',
                    }}
                  >
                    {b.range === 'in' ? 'IN RANGE' : 'OUT OF RANGE'}
                  </span>
                ) : null}
                <div style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {fmtUsd(b.value)}
                </span>
              </div>
              {b.sections.map((s, si) => (
                <div
                  key={si}
                  style={
                    si === 0
                      ? { padding: '12px 0 4px' }
                      : { padding: '14px 0 4px', borderTop: '1px solid var(--line)' }
                  }
                >
                  {s.label ? (
                    // The heading names the run of rows below it. Its total is
                    // dropped over a single row, where it would be that row's
                    // own figure a second time.
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '0 16px 8px',
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 10.5, letterSpacing: '0.14em', color: sectionColor(s) }}
                      >
                        {s.label}
                      </span>
                      {s.total !== null ? (
                        <span
                          className="mono"
                          style={{ fontSize: 12.5, fontWeight: 600, color: sectionColor(s) }}
                        >
                          {s.negative ? '−' : ''}
                          {fmtUsd(s.total)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {s.columns ? (
                    // Printed once per block: the sections below are the same
                    // four columns, and a heading repeated is a heading ignored
                    <div className="pos-grid" style={{ padding: '2px 16px 4px' }}>
                      {[s.firstColumn, 'PRICE', 'AMOUNT', 'USD VALUE'].map((label, ci) => (
                        <span
                          key={label}
                          className={`mono${ci === 1 ? ' pos-price' : ''}`}
                          style={{
                            fontSize: 9.5,
                            letterSpacing: '0.14em',
                            color: 'var(--mut)',
                            textAlign: ci ? 'right' : 'left',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {s.rows.map((r, ri) => (
                    <div
                      key={ri}
                      className="pos-grid"
                      // No rule between rows: the padding carries the rhythm, and
                      // a line under every holding turned a wallet into a grate.
                      // Borders survive where they separate different things —
                      // between sections, and between blocks.
                      style={{ alignItems: 'center', padding: '10px 16px' }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 0,
                          fontWeight: 700,
                          fontSize: 13.5,
                          color: sectionColor(s) ?? 'var(--text)',
                        }}
                      >
                        <ChainBadge network={r.network} size={18} />
                        <span
                          style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {r.title}
                        </span>
                      </span>
                      <span className="mono pos-price" style={cellStyle}>
                        {r.priceUsd == null ? '—' : fmtPrice(r.priceUsd)}
                      </span>
                      <span className="mono" style={cellStyle}>
                        {r.amount == null ? '—' : fmtAmount(r.amount)}
                      </span>
                      <span
                        className="mono"
                        style={{ ...cellStyle, color: sectionColor(s) ?? 'var(--text)' }}
                      >
                        {s.negative ? '−' : ''}
                        {fmtUsd(r.value)}
                      </span>
                    </div>
                  ))}
                </div>
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
