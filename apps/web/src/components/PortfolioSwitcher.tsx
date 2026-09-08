'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedPortfolioDto } from '@svinooh/shared';
import { track } from '../lib/analytics';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { portfolioLabel } from '../lib/format';
import { MenuItem, Select, Spinner } from '../ui';
import { usePaywall } from './Paywall';

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
  const { showPaywall } = usePaywall();
  const [creating, setCreating] = useState(false);

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
    } catch (err) {
      // The second portfolio is the free plan's edge — the dialog explains it;
      // anything else, pressing again retries
      showPaywall(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Select
      // ph-mask: portfolio names are the owner's own words about their money —
      // session replay stores asterisks instead (see instrumentation-client.ts)
      className="ph-mask portfolio-switcher"
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
        // Capped by the stylesheet instead: on a phone the header has to fit a
        // wordmark, a toggle and an avatar beside this, and 180px of somebody's
        // portfolio name is more than the row can spare.
        minWidth: 0,
      }}
      footer={
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
      }
    />
  );
}
