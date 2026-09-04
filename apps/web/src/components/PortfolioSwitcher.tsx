'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedPortfolioDto } from '@svinooh/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { portfolioLabel } from '../lib/format';
import { Button, Dialog, DialogActions, MenuItem, Note, Panel, Spinner, useDismiss } from '../ui';

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onClose: close, refs: [box] });

  const current = portfolios.find((p) => p.slug === currentSlug);

  const createPortfolio = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { slug } = await api<{ slug: string }>('/portfolios', { method: 'POST' });
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

  /**
   * Deletes the portfolio this page is on, then moves to one that still
   * exists. The me-list is refreshed first so the page we land on doesn't
   * offer the deleted portfolio in this very switcher.
   */
  const deletePortfolio = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api(`/portfolios/${currentSlug}`, { method: 'DELETE' });
      const next = portfolios.find((p) => p.slug !== currentSlug);
      await refreshMe();
      setConfirmDelete(false);
      router.push(next ? `/p/${next.slug}` : '/');
    } catch (err) {
      setConfirmDelete(false);
      alert(err instanceof Error ? err.message : 'Could not delete this portfolio');
    } finally {
      setDeleting(false);
    }
  };

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
          {/* Only when there is somewhere to land afterwards — the account's
              last portfolio is not deletable (the server refuses too) */}
          {portfolios.length > 1 ? (
            <MenuItem
              tone="danger"
              onClick={() => {
                close();
                setConfirmDelete(true);
              }}
            >
              Delete this portfolio
            </MenuItem>
          ) : null}
        </Panel>
      ) : null}

      {confirmDelete ? (
        <DeletePortfolioModal
          label={portfolioLabel(current?.name ?? null, currentSlug)}
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deletePortfolio()}
        />
      ) : null}
    </div>
  );
}

/**
 * Deleting takes the history and the wallet list with it and the link goes
 * dead, so it gets the same explicit "here is what changes" step publishing
 * does. The addresses themselves are untouched — worth saying, or "delete"
 * reads as bigger than it is.
 */
function DeletePortfolioModal({
  label,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog onClose={onCancel} title={`Delete ${label}?`}>
      <div style={{ fontSize: 'var(--fs-title)', fontWeight: 'var(--fw-heavy)' }}>
        Delete {label}?
      </div>
      <Note style={{ marginTop: 'var(--sp-5)', lineHeight: 1.7 }}>
        Its wallet list and its history are deleted and{' '}
        <strong style={{ color: 'var(--text)' }}>its link stops working</strong> — for you and for
        anyone you shared it with. This cannot be undone.
        <br />
        <br />
        The wallet addresses themselves are untouched; any other portfolio tracking them keeps its
        own history.
      </Note>
      <DialogActions>
        <Button variant="quiet" size="lg" block onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" size="lg" block loading={busy} onClick={onConfirm}>
          Delete portfolio
        </Button>
      </DialogActions>
    </Dialog>
  );
}
