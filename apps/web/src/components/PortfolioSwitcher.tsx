'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedPortfolioDto } from '@svinooh/shared';
import { track } from '../lib/analytics';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { portfolioLabel } from '../lib/format';
import { MenuItem, Panel, Spinner, useDismiss } from '../ui';

/**
 * Which of the account's portfolios this page is — and the door to another.
 * In the header because it answers a header-sized question: "where am I,
 * where else could I be, and how do I get one more". Shown to every owner,
 * one portfolio or many, since the new-portfolio button lives in it.
 */
export function PortfolioSwitcher({
  portfolios,
  currentSlug,
}: {
  portfolios: OwnedPortfolioDto[];
  currentSlug: string;
}) {
  const router = useRouter();
  const { refreshMe } = useAuth();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onClose: close, refs: [box] });

  const current = portfolios.find((p) => p.slug === currentSlug);

  const createPortfolio = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { slug } = await api<{ slug: string }>('/portfolios', { method: 'POST' });
      track('portfolio_created', { source: 'switcher' });
      // The list the switcher reads has to know about the newcomer before the
      // page it navigates to asks who owns it
      await refreshMe();
      close();
      router.push(`/p/${slug}`);
    } catch {
      // The menu stays open; pressing again retries
    } finally {
      setCreating(false);
    }
  };

  return (
    // ph-mask: portfolio names are the owner's own words about their money —
    // session replay stores asterisks instead (see instrumentation-client.ts)
    <div ref={box} className="ph-mask" style={{ position: 'relative', minWidth: 0 }}>
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
          <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
          <MenuItem onClick={() => void createPortfolio()} disabled={creating}>
            {creating ? (
              <Spinner size={13} />
            ) : (
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
            <span style={{ marginLeft: 7 }}>New portfolio</span>
          </MenuItem>
        </Panel>
      ) : null}
    </div>
  );
}
