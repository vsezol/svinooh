'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedPortfolioDto } from '@svinooh/shared';
import { track } from '../lib/analytics';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { portfolioLabel } from '../lib/format';
import { Button, Dialog, DialogActions, Note } from '../ui';

/**
 * The way out of a portfolio, at the very bottom of its page — small, red,
 * and after everything else, which is where an ending belongs. Owners only:
 * an anonymous portfolio belongs to nobody, so nobody gets to end it. The
 * caller also keeps it off the account's last portfolio — the server refuses
 * that anyway (signing in promises every account a portfolio).
 */
export function DeletePortfolio({
  slug,
  portfolios,
}: {
  slug: string;
  portfolios: OwnedPortfolioDto[];
}) {
  const router = useRouter();
  const { refreshMe } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const current = portfolios.find((p) => p.slug === slug);

  /**
   * Deletes this portfolio, then moves to one that still exists. The me-list
   * is refreshed first so the page we land on doesn't offer the deleted one
   * in its switcher.
   */
  const deletePortfolio = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api(`/portfolios/${slug}`, { method: 'DELETE' });
      track('portfolio_deleted', { source: 'page' });
      const next = portfolios.find((p) => p.slug !== slug);
      await refreshMe();
      setConfirm(false);
      router.push(next ? `/p/${next.slug}` : '/');
    } catch (err) {
      setConfirm(false);
      alert(err instanceof Error ? err.message : 'Could not delete this portfolio');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div style={{ marginTop: 40, textAlign: 'center' }}>
        <button
          onClick={() => setConfirm(true)}
          className="mono"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--down)',
            fontSize: 'var(--fs-tag)',
            letterSpacing: '0.06em',
            cursor: 'pointer',
            padding: '6px 10px',
            opacity: 0.85,
          }}
        >
          Delete this portfolio
        </button>
      </div>

      {confirm ? (
        <DeletePortfolioModal
          label={portfolioLabel(current?.name ?? null, slug)}
          busy={deleting}
          onCancel={() => setConfirm(false)}
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
