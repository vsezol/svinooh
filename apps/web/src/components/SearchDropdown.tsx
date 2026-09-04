import type { AddressLookupDto, PublicPortfolioDto } from '@svinooh/shared';
import { Panel, Spinner } from '../ui';
import { chainMeta, fmtUsd0, portfolioLabel, shortAddress } from '../lib/format';

/**
 * Results for what is being typed, right under the input. Anything that looks
 * like an address gets its own row — whether it is tracked yet or not — so a
 * search never dead-ends. An address already known shows its network, its name
 * and what it was last worth; a new one says it opens public with no sign-in.
 * Clicking either goes to its portfolio, created on the spot when missing.
 *
 * Rows carry no owner, only the portfolio and its wallets: this list is public.
 */
export function SearchDropdown({
  results,
  looksLikeAddress,
  lookup,
  query,
  tracking,
  error,
  onPick,
  onOpenAddress,
}: {
  /** null — the request is still in flight */
  results: PublicPortfolioDto[] | null;
  looksLikeAddress: boolean;
  /** null — no lookup yet (in flight, or the input isn't an address) */
  lookup: AddressLookupDto | null;
  /** What is being typed — the address row's text until the lookup answers */
  query: string;
  tracking: boolean;
  error: string | null;
  onPick: (slug: string) => void;
  onOpenAddress: () => void;
}) {
  // The address row already stands for its own portfolio — don't list it twice
  const rows = (results ?? []).filter((p) => p.slug !== lookup?.slug);
  const unsupported = lookup !== null && lookup.chain === null;
  const address = lookup?.address ?? query;
  const network = lookup?.chain ? chainMeta(lookup.chain).label : null;

  return (
    // ph-mask: the address row echoes what the visitor pasted and what it is
    // worth — session replay keeps the dropdown's shape, not its words
    <Panel className="ph-mask" style={{ position: 'absolute', top: 'calc(100% + var(--sp-3))', left: 0, right: 0, zIndex: 60 }}>
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

      {results !== null && looksLikeAddress && unsupported ? (
        <div
          className="mono"
          style={{
            padding: '11px 14px',
            fontSize: 'var(--fs-tag)',
            color: 'var(--mut)',
            borderTop: rows.length ? '1px solid var(--line)' : 'none',
          }}
        >
          Not an address on a supported network
        </div>
      ) : null}

      {results !== null && looksLikeAddress && !unsupported ? (
        <div
          onMouseDown={(e) => e.preventDefault()}
          onClick={onOpenAddress}
          className="row-hover"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-4)',
            padding: '10px 14px',
            borderTop: rows.length ? '1px solid var(--line)' : 'none',
            cursor: tracking ? 'default' : 'pointer',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* An anonymous portfolio's name when one was set, else the address
                itself — never anything about a person */}
            <div
              className={lookup?.name ? undefined : 'mono'}
              style={{
                fontWeight: 'var(--fw-bold)',
                fontSize: 'var(--fs-note)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {lookup?.name ?? shortAddress(address)}
            </div>
            <div
              className="mono"
              style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)', marginTop: 'var(--sp-1)' }}
            >
              {network === null
                ? 'wallet address'
                : lookup?.name
                  ? `${network} · ${shortAddress(address)}`
                  : lookup?.slug
                    ? `${network} · tracked`
                    : `${network} · public, no sign-in`}
            </div>
          </div>
          {tracking ? (
            <Spinner size={12} />
          ) : lookup?.totalUsd != null ? (
            <span className="mono" style={{ fontSize: 'var(--fs-note)', fontWeight: 'var(--fw-medium)' }}>
              {fmtUsd0(lookup.totalUsd)}
            </span>
          ) : (
            <span
              className="mono"
              style={{ fontSize: 'var(--fs-tag)', letterSpacing: 'var(--tr-tag)', color: 'var(--acc-text)' }}
            >
              {lookup?.slug ? 'OPEN →' : 'TRACK →'}
            </span>
          )}
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
