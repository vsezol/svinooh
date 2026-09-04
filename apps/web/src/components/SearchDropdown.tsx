import type { PublicPortfolioDto } from '@svinooh/shared';
import { Panel, Spinner } from '../ui';
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
    <Panel style={{ position: 'absolute', top: 'calc(100% + var(--sp-3))', left: 0, right: 0, zIndex: 60 }}>
      {results === null ? (
        <div className="mono" style={{ padding: '14px 16px', fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
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
            gap: 'var(--sp-4)',
            padding: '10px 14px',
            borderTop: i ? '1px solid var(--line)' : 'none',
            cursor: 'pointer',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className={p.name ? undefined : 'mono'}
              style={{
                fontWeight: 'var(--fw-bold)',
                fontSize: 'var(--fs-note)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {portfolioLabel(p.name, p.slug)}
            </div>
            <div
              className="mono"
              style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)', marginTop: 'var(--sp-1)' }}
            >
              {p.walletCount} {p.walletCount === 1 ? 'wallet' : 'wallets'} · {p.chains.join(' + ') || '—'}
            </div>
          </div>
          <span className="mono" style={{ fontSize: 'var(--fs-note)', fontWeight: 'var(--fw-medium)' }}>
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
            <Spinner size={12} />
          ) : (
            <span style={{ fontSize: 'var(--fs-body)', lineHeight: 1 }}>+</span>
          )}
          <span className="mono" style={{ fontSize: 'var(--fs-tag)', letterSpacing: 'var(--tr-tag)' }}>
            {tracking ? 'Opening…' : 'Track this address — public, no sign-in'}
          </span>
        </div>
      ) : null}

      {results !== null && !rows.length && !looksLikeAddress ? (
        <div className="mono" style={{ padding: '14px 16px', fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
          Nothing found. Paste a wallet address to track one.
        </div>
      ) : null}

      {error ? (
        <div
          className="mono"
          style={{
            padding: '10px 14px',
            fontSize: 'var(--fs-tag)',
            color: 'var(--down)',
            borderTop: '1px solid var(--line)',
          }}
        >
          {error}
        </div>
      ) : null}
    </Panel>
  );
}
