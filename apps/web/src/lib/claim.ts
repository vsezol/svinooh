import type { MeDto } from '@svinooh/shared';
import { api } from './api';

const KEY = 'svinooh_claim';

/**
 * Which ownerless portfolio the visitor set out to take over before they were
 * asked to sign in.
 *
 * It lives in sessionStorage because signing in can take a detour through the
 * Telegram app and come back to a different tab — an intent held in React state
 * would not survive that.
 */
export const pendingClaim = {
  get(): string | null {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(slug: string): void {
    try {
      sessionStorage.setItem(KEY, slug);
    } catch {
      /* private mode — the claim just won't survive a reload */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

/**
 * Runs on every successful sign-in. If the visitor was in the middle of taking
 * over a portfolio, do it now and point "your portfolio" at that one, so the
 * navigation that follows a login lands them where they were rather than on a
 * fresh empty portfolio.
 */
export async function settleClaim(me: MeDto): Promise<MeDto> {
  const slug = pendingClaim.get();
  if (!slug) return me;
  pendingClaim.clear();
  try {
    const claimed = await api<{ slug: string }>(`/portfolios/${slug}/claim`, { method: 'POST' });
    return { ...me, portfolioSlug: claimed.slug };
  } catch {
    // Someone else got there first, or the portfolio is gone. Their own
    // portfolio is still waiting for them, so carry on with it.
    return me;
  }
}
