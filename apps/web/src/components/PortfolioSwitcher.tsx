'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedPortfolioDto } from '@svinooh/shared';
import { track } from '../lib/analytics';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { portfolioLabel } from '../lib/format';
import { Button, Dialog, DialogActions, MenuItem, Note, Select, Spinner } from '../ui';

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
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      router.push(`/p/${slug}`);
    } catch {
      // Pressing again retries
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
      track('portfolio_deleted', { source: 'switcher' });
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
    <>
      <Select
        // ph-mask: portfolio names are the owner's own words about their money —
        // session replay stores asterisks instead (see instrumentation-client.ts)
        className="ph-mask"
        label="Switch portfolio"
        value={currentSlug}
        onChange={(slug) => router.push(`/p/${slug}`)}
        options={portfolios.map((p) => ({ value: p.slug, label: portfolioLabel(p.name, p.slug) }))}
        mono
        align="right"
        minMenuWidth={200}
        triggerStyle={{
          height: 'var(--h-sm)',
          borderRadius: 'var(--r-full)',
          background: 'transparent',
          fontSize: 'var(--fs-note)',
          fontWeight: 'var(--fw-bold)',
          maxWidth: 180,
        }}
        footer={
          <>
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
              <MenuItem tone="danger" onClick={() => setConfirmDelete(true)}>
                Delete this portfolio
              </MenuItem>
            ) : null}
          </>
        }
      />

      {confirmDelete ? (
        <DeletePortfolioModal
          label={portfolioLabel(current?.name ?? null, currentSlug)}
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deletePortfolio()}
        />
      ) : null}
    </>
  );
}

/**
 * Deleting takes the history and the wallet list with it and the link goes
 * dead, so it gets the same explicit "here is what changes" step publishing
 * does. The addresses themselves are untouched — worth saying, or "delete"
 * reads as bigger than it is.
 *
 * The aria title stays generic: the name is masked in session replay
 * (ph-mask), and an attribute would carry it around the mask.
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
    <Dialog onClose={onCancel} title="Delete this portfolio?">
      <div style={{ fontSize: 'var(--fs-title)', fontWeight: 'var(--fw-heavy)' }}>
        Delete <span className="ph-mask">{label}</span>?
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
