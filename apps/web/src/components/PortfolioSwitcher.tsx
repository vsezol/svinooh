'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedPortfolioDto } from '@svinooh/shared';
import { portfolioLabel } from '../lib/format';
import { MenuItem, Panel, useDismiss } from '../ui';

/**
 * Which of the account's portfolios this page is. In the header, and only
 * there, because it answers a header-sized question — "where am I, and where
 * else could I be" — and only once there IS anywhere else: one portfolio
 * renders nothing, which is every account that never claimed a second one.
 */
export function PortfolioSwitcher({
  portfolios,
  currentSlug,
}: {
  portfolios: OwnedPortfolioDto[];
  currentSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onClose: close, refs: [box] });

  if (portfolios.length < 2) return null;
  const current = portfolios.find((p) => p.slug === currentSlug);

  return (
    <div ref={box} style={{ position: 'relative', minWidth: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch portfolio"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          border: '1px solid var(--line2)',
          background: 'transparent',
          color: 'var(--text)',
          borderRadius: 'var(--r-full)',
          height: 'var(--h-sm)',
          padding: '0 12px',
          cursor: 'pointer',
          maxWidth: 180,
          fontFamily: 'var(--sans)',
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 'var(--fs-note)',
            fontWeight: 'var(--fw-bold)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {portfolioLabel(current?.name ?? null, currentSlug)}
        </span>
        <span
          style={{
            width: 7,
            height: 7,
            borderRight: '1.5px solid var(--mut)',
            borderBottom: '1.5px solid var(--mut)',
            transform: 'rotate(45deg) translate(-1px,-1px)',
            flexShrink: 0,
          }}
        />
      </button>

      {open ? (
        <Panel
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 200,
            zIndex: 70,
            padding: 4,
          }}
        >
          {portfolios.map((p) => (
            <MenuItem
              key={p.slug}
              role="option"
              aria-selected={p.slug === currentSlug}
              selected={p.slug === currentSlug}
              onClick={() => {
                close();
                if (p.slug !== currentSlug) router.push(`/p/${p.slug}`);
              }}
            >
              <span
                className="mono"
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {portfolioLabel(p.name, p.slug)}
              </span>
            </MenuItem>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
