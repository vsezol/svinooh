'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ProFeature, ProOfferDto } from '@svinooh/shared';
import { track } from '../lib/analytics';
import { isPaywall } from '../lib/billing';
import { Button, Dialog, DialogActions, Note, Tag, Title } from '../ui';

/**
 * The paywall, as one dialog the whole app shares.
 *
 * Every gated request answers 402 with the feature it refused and the current
 * offer, so this renders entirely from the error — no fetch, no numbers of its
 * own. Call sites do `if (showPaywall(err)) return;` in their catch and keep
 * their ordinary error handling for everything that was not a wall.
 */
interface Ask {
  feature: ProFeature;
  message: string;
  offer: ProOfferDto;
}

const PaywallContext = createContext<{ showPaywall: (err: unknown) => boolean }>({
  showPaywall: () => false,
});

/**
 * What each wall is called. The headline names the wish, not the refusal —
 * the server's message below it already explains the limit with live numbers.
 */
const HEADLINES: Record<ProFeature, string> = {
  portfolios: 'More portfolios come with Pro',
  wallets: 'Bigger portfolios come with Pro',
  history: 'The whole history comes with Pro',
  alerts: 'Alerts without a counter come with Pro',
  ai: 'More questions come with Pro',
};

export function PaywallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);

  const showPaywall = useCallback((err: unknown): boolean => {
    if (!isPaywall(err)) return false;
    const feature = err.feature ?? 'portfolios';
    setAsk({ feature, message: err.message, offer: err.offer });
    track('paywall_shown', { feature });
    return true;
  }, []);

  const close = () => setAsk(null);
  const toPro = () => {
    if (ask) track('paywall_cta', { feature: ask.feature });
    setAsk(null);
    router.push('/pro');
  };

  return (
    <PaywallContext.Provider value={{ showPaywall }}>
      {children}
      {ask ? (
        <Dialog onClose={close} title="Svinooh.Pro">
          <ProPrice offer={ask.offer} headline={HEADLINES[ask.feature]} note={ask.message} />
          <DialogActions>
            <Button variant="soft" style={{ flex: 1 }} onClick={close}>
              Not now
            </Button>
            <Button style={{ flex: 1 }} onClick={toPro}>
              Get Svinooh.Pro
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </PaywallContext.Provider>
  );
}

export const usePaywall = () => useContext(PaywallContext);

/**
 * The offer, priced. Shared between the dialog and the /pro page so the two
 * never disagree about how the same numbers are staged: the anchor crossed
 * out, the live price large, the first month as its own line.
 */
export function ProPrice({
  offer,
  headline,
  note,
}: {
  offer: ProOfferDto;
  headline: string;
  note?: string;
}) {
  return (
    <div>
      <Title>{headline}</Title>
      {note ? <Note style={{ marginTop: 8, lineHeight: 1.55 }}>{note}</Note> : null}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-hero)', fontWeight: 'var(--fw-medium)', letterSpacing: '-0.02em' }}
        >
          ${offer.priceUsd}
        </span>
        <span style={{ fontSize: 'var(--fs-note)', color: 'var(--mut)' }}>/ month</span>
        {offer.discountPct > 0 ? (
          <>
            <span
              className="mono"
              style={{ fontSize: 'var(--fs-lead)', color: 'var(--mut)', textDecoration: 'line-through' }}
            >
              ${offer.wasPriceUsd}
            </span>
            <Tag variant="soft">-{offer.discountPct}%</Tag>
          </>
        ) : null}
      </div>
      {offer.firstMonthUsd < offer.priceUsd ? (
        <Note style={{ marginTop: 8 }}>
          First month <b style={{ color: 'var(--fg)' }}>${offer.firstMonthUsd}</b>
          {offer.firstMonthDiscountPct > 0 ? ` — ${offer.firstMonthDiscountPct}% off` : ''}, then $
          {offer.priceUsd}/month. Cancel by simply not renewing.
        </Note>
      ) : null}
    </div>
  );
}
