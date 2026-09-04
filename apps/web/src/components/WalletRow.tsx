import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { PositionTokenRole, WalletDto } from '@svinooh/shared';
import { buildBlocks, withoutDust, type BlockSection } from '../lib/blocks';
import { chainMeta, fmtAmount, fmtPrice, fmtUsd, shortAddress, walletName } from '../lib/format';
import { Card, Chevron, Spinner, Tag, Tooltip } from '../ui';
import { badgedText, ChainBadge } from './ChainBadge';
import { RangeBar } from './RangeBar';
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
  fontSize: 'var(--fs-body)',
  fontWeight: 'var(--fw-normal)',
  textAlign: 'right' as const,
  color: 'var(--mut)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  minWidth: 0,
};

/**
 * The small mono notes on a block's header line — the kind of position, the
 * pair, the APY, the health factor. Six of them, and each was stating the same
 * three properties with its own idea of the size.
 */
const NOTE = {
  fontSize: 'var(--fs-micro)',
  letterSpacing: 'var(--tr-tag)',
  color: 'var(--mut)',
} as const;

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
  /** Hide balances under a dollar — see isDustValue */
  hideSmall: boolean;
  onRemove: () => void;
  onRename: (label: string) => void;
  /** Pressing a locked action */
  onRequireAuth: () => void;
}

export function WalletRow({ wallet, actions, total, hideSmall, onRemove, onRename, onRequireAuth }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const chain = chainMeta(wallet.chain);
  const label = walletName(wallet.label, wallet.chain);
  const syncing = wallet.status === 'pending' && wallet.totalUsd === null;
  const blocks = useMemo(() => {
    const built = buildBlocks(wallet.positions);
    return hideSmall ? withoutDust(built) : built;
  }, [wallet.positions, hideSmall]);
  const tron = wallet.tron ?? null;
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
    // ph-mask: everything in a row — address, label, positions, values — is
    // somebody's money; session replay keeps the layout and loses the words
    <Card className="ph-mask" style={{ overflow: 'hidden' }}>
      <div
        onClick={() => !syncing && setCollapsed((v) => !v)}
        className="row-hover"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-5)',
          padding: '13px 16px',
          cursor: syncing ? 'default' : 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* The name gives way, never the line: a long label ellipsizes and
              the chain chip stays beside it, rather than wrapping under */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
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
                  fontWeight: 'var(--fw-bold)',
                  fontSize: 'var(--fs-body)',
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
                  fontWeight: 'var(--fw-bold)',
                  fontSize: 'var(--fs-lead)',
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </span>
            )}
            <Tag variant="outline" size="sm" style={{ height: 20, padding: '0 var(--sp-4)', flexShrink: 0 }}>
              {chain.label}
            </Tag>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginTop: 3 }}>
            <span
              className="mono"
              style={{
                fontSize: 'var(--fs-note)',
                fontWeight: 'var(--fw-normal)',
                color: wallet.status === 'failed' ? 'var(--down)' : 'var(--mut)',
              }}
            >
              {wallet.status === 'failed'
                ? 'sync failed'
                : wallet.stale
                  ? `stale · ${shortAddress(wallet.address)}`
                  : shortAddress(wallet.address)}
            </span>
            <span
              onClick={copy}
              className="mono copy-link"
              style={{
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tr-tag)',
                color: 'var(--mut)',
                cursor: 'pointer',
              }}
            >
              {copied ? 'COPIED' : 'COPY'}
            </span>
          </div>
        </div>

        {syncing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
            <Spinner size={14} />
            <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
              syncing…
            </span>
          </div>
        ) : (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="mono" style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-lead)' }}>
              {fmtUsd(wallet.totalUsd)}
            </div>
            <div className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', marginTop: 'var(--sp-1)' }}>
              {share}
            </div>
          </div>
        )}

        {!syncing && blocks.length > 0 ? <Chevron open={expanded} /> : null}

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
        <div
          style={{
            borderTop: '1px solid var(--line)',
            padding: 'var(--sp-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-4)',
          }}
        >
          {tron ? <TronResources tron={tron} /> : null}
          {blocks.map((b, i) => (
            <div
              key={i}
              style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surf2)' }}
            >
              {/* One line, allowed to wrap among itself: name, what kind of
                  position it is, its detail, and whether it is in range — then
                  the money, held against the right edge. The pieces are all
                  short now that the chain is a mark and the pair is in the
                  table below, so a second line would be a line of air. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-4)',
                  padding: '11px 14px',
                  flexWrap: 'wrap',
                }}
              >
                <span style={badgedText(!!b.network)}>
                  <span style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-body)', whiteSpace: 'nowrap' }}>
                    {b.proto}
                  </span>
                  <ChainBadge network={b.network} />
                </span>
                {b.count > 1 ? (
                  <Tooltip text={`${b.count} positions folded together`}>
                    <span className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)' }}>
                      ×{b.count}
                    </span>
                  </Tooltip>
                ) : null}
                {b.typeLabel ? (
                  <span className="mono" style={NOTE}>
                    {b.typeLabel}
                  </span>
                ) : null}
                {b.meta ? (
                  <span className="mono" style={NOTE}>
                    {b.meta}
                  </span>
                ) : null}
                {b.apy != null ? (
                  <span className="mono" style={{ ...NOTE, color: b.apy >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {fmtApy(b.apy)}
                  </span>
                ) : null}
                {b.healthRate != null ? (
                  <Tooltip text="Health factor — below 1 the position is liquidated">
                    <span
                      className="mono"
                      style={{ ...NOTE, color: b.healthRate < 1.5 ? 'var(--down)' : 'var(--mut)' }}
                    >
                      HF {b.healthRate.toFixed(2)}
                    </span>
                  </Tooltip>
                ) : null}
                {b.range ? (
                  // Plain coloured text, not a bordered pill: it sits among
                  // other small mono notes and a box around one of them makes
                  // it a button that cannot be pressed
                  <Tooltip
                    text={
                      b.range === 'in'
                        ? 'The price is inside the position range — it is earning fees'
                        : 'The price has left the position range — it sits in one token and earns nothing'
                    }
                  >
                    <span
                      className="mono"
                      style={{
                        ...NOTE,
                        letterSpacing: '0.12em',
                        whiteSpace: 'nowrap',
                        fontWeight: 'var(--fw-medium)',
                        color: b.range === 'in' ? 'var(--up)' : 'var(--down)',
                      }}
                    >
                      {b.range === 'in' ? 'IN RANGE' : 'OUT OF RANGE'}
                    </span>
                  </Tooltip>
                ) : null}
                <div style={{ flex: 1 }} />
                <span
                  className="mono"
                  style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)', whiteSpace: 'nowrap' }}
                >
                  {fmtUsd(b.value)}
                </span>
              </div>
              {/* Where the price sits between the bounds — the part "IN RANGE"
                  cannot say. Only where the protocol answered for the band. */}
              {b.band ? <RangeBar band={b.band} inRange={b.range !== 'out'} /> : null}
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
                        gap: 'var(--sp-4)',
                        padding: '0 16px var(--sp-4)',
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 'var(--fs-micro)', letterSpacing: '0.14em', color: sectionColor(s) }}
                      >
                        {s.label}
                      </span>
                      {s.total !== null ? (
                        <span
                          className="mono"
                          style={{
                            fontSize: 'var(--fs-note)',
                            fontWeight: 'var(--fw-medium)',
                            color: sectionColor(s),
                          }}
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
                            fontSize: 'var(--fs-micro)',
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
                      <span style={badgedText(!!r.network)}>
                        <span
                          style={{
                            fontWeight: 'var(--fw-bold)',
                            fontSize: 'var(--fs-body)',
                            color: sectionColor(s) ?? 'var(--text)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.title}
                        </span>
                        <ChainBadge network={r.network} />
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
            <div className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', padding: '2px 4px' }}>
              {wallet.unpriced.length} asset(s) without a price source — not included in the total
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
