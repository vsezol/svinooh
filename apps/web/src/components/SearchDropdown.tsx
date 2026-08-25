import type { PublicPortfolioDto } from '@svinooh/shared';
import { fmtUsd0, portfolioLabel } from '../lib/format';

/**
 * Results for what is being typed, right under the input. Anything that isn't
 * tracked yet but looks like an address gets an explicit "track it" row, so a
 * search never dead-ends — that row creates an ownerless portfolio on the spot.
 *
 * Rows carry no owner, only the portfolio and its wallets: this list is public.
 */
export function SearchDropdown({
  results,
  looksLikeAddress,
  tracking,
  error,
  onPick,
  onTrack,
}: {
  /** null — the request is still in flight */
  results: PublicPortfolioDto[] | null;
  looksLikeAddress: boolean;
  tracking: boolean;
  error: string | null;
  onPick: (slug: string) => void;
  onTrack: () => void;
}) {
  const rows = results ?? [];

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        zIndex: 60,
        background: 'var(--surf)',
        border: '1px solid var(--line2)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 60px -30px rgba(0,0,0,0.6)',
      }}
    >
      {results === null ? (
        <div className="mono" style={{ padding: '14px 16px', fontSize: 11, color: 'var(--mut)' }}>
          Searching…
        </div>
      ) : null}

      {rows.map((p, i) => (
        <div
          key={p.slug}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(p.slug)}
          className="row-hover"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderTop: i ? '1px solid var(--line)' : 'none',
            cursor: 'pointer',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className={p.name ? undefined : 'mono'}
              style={{ fontWeight: 700, fontSize: p.name ? 12.5 : 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {portfolioLabel(p.name, p.slug)}
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--mut)', marginTop: 2 }}>
              {p.walletCount} {p.walletCount === 1 ? 'wallet' : 'wallets'} · {p.chains.join(' + ') || '—'}
            </div>
          </div>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
            {fmtUsd0(p.totalUsd)}
          </span>
        </div>
      ))}

      {results !== null && looksLikeAddress ? (
        <div
          onMouseDown={(e) => e.preventDefault()}
          onClick={onTrack}
          className="row-hover"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '11px 14px',
            borderTop: rows.length ? '1px solid var(--line)' : 'none',
            cursor: tracking ? 'default' : 'pointer',
            color: 'var(--acc-text)',
          }}
        >
          {tracking ? (
            <span className="spin" style={{ width: 12, height: 12 }} />
          ) : (
            <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
          )}
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.04em' }}>
            {tracking ? 'Opening…' : 'Track this address — public, no sign-in'}
          </span>
        </div>
      ) : null}

      {results !== null && !rows.length && !looksLikeAddress ? (
        <div className="mono" style={{ padding: '14px 16px', fontSize: 11, color: 'var(--mut)' }}>
          Nothing found. Paste a wallet address to track one.
        </div>
      ) : null}

      {error ? (
        <div className="mono" style={{ padding: '10px 14px', fontSize: 10.5, color: 'var(--down)', borderTop: '1px solid var(--line)' }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
