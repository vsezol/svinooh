'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingMeDto, ProOfferDto, ProPaymentDto } from '@svinooh/shared';
import { AuthModal } from '../components/AuthModal';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { track } from '../lib/analytics';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getBillingMe, getOffer, openCheckout } from '../lib/billing';

/**
 * The marketing page, to the design file: a dot-grid hero where the first
 * month is the figure the whole screen is about, five tiles for what Pro
 * unlocks, one closer — and a price card that plays every state the page can
 * be in (signed out, welcome price, renewal, opening the invoice, waiting for
 * the chain, Pro active, the payment history).
 *
 * Every number comes off the server: the offer is operator-tunable and
 * arrives prerendered from the route, then refreshed in the browser — the
 * page can never advertise a price the checkout would contradict.
 */

/** 'Oct 4, 2026' — how the design writes a date people plan around */
const dateLong = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** 'Sep 04, 2026' — the payments column, where the digits should line up */
const dateRow = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

const EYEBROW = {
  fontSize: 10,
  letterSpacing: '0.16em',
  color: 'var(--mut)',
} as const;

const CTA = {
  height: 48,
  borderRadius: 'var(--r-full)',
  background: 'var(--acc)',
  color: 'var(--acc-ink)',
  fontSize: 15,
  fontWeight: 'var(--fw-heavy)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  cursor: 'pointer',
  border: 'none',
  width: '100%',
  fontFamily: 'inherit',
} as const;

/** The dark-ink spinner inside a pressed CTA — see the states sheet, 03 */
function InkSpinner() {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: '2px solid color-mix(in srgb, var(--acc-ink) 30%, transparent)',
        borderTopColor: 'var(--acc-ink)',
        display: 'inline-block',
        animation: 'pro-spin 0.8s linear infinite',
      }}
    />
  );
}

export function ProPage({ preloaded }: { preloaded: ProOfferDto | null }) {
  const { me } = useAuth();
  const [offer, setOffer] = useState<ProOfferDto | null>(preloaded);
  const [billing, setBilling] = useState<BillingMeDto | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyErr, setBuyErr] = useState<string | null>(null);
  // Arrived back from the gateway's success page — Pro switches on when the
  // network confirms, so the page checks back until it has
  const [awaitingPayment, setAwaitingPayment] = useState(false);

  useEffect(() => {
    track('pro_opened', {});
    if (new URLSearchParams(window.location.search).get('paid') === '1') setAwaitingPayment(true);
  }, []);

  // The prerendered offer may be a minute old, or missing when the API was
  // down at build time — the browser asks again either way
  useEffect(() => {
    void getOffer()
      .then(setOffer)
      .catch(() => undefined);
  }, []);

  const refreshBilling = useCallback(async () => {
    try {
      setBilling(await getBillingMe());
    } catch {
      // an expired session shows the signed-out pitch, which is still true
    }
  }, []);

  useEffect(() => {
    if (me) void refreshBilling();
    else setBilling(null);
  }, [me, refreshBilling]);

  // "CHECKING EVERY 10S", and the card says so — see the waiting state
  useEffect(() => {
    if (!awaitingPayment || !me || billing?.pro) return;
    const timer = setInterval(() => void refreshBilling(), 10_000);
    return () => clearInterval(timer);
  }, [awaitingPayment, me, billing?.pro, refreshBilling]);

  // Coming BACK from the invoice: bfcache restores the page mid-"buying", and
  // a button spinning forever over a checkout that already opened reads as
  // broken. The restore also re-asks whether the payment landed meanwhile.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setBuying(false);
      void refreshBilling();
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [refreshBilling]);

  const buy = async () => {
    if (buying) return;
    if (!me) {
      setAuthOpen(true);
      return;
    }
    setBuying(true);
    setBuyErr(null);
    track('checkout_opened', { firstMonth: billing?.firstMonthEligible ?? true });
    // Claimed inside the click, before any await — a tab opened after an
    // async gap is a tab popup blockers eat. Blocked, this stays null and the
    // invoice takes over this tab instead, the way it always did.
    const tab = window.open('', '_blank');
    try {
      const url = await openCheckout();
      if (tab && !tab.closed) {
        tab.location.href = url;
        // The page stays under the payer and starts watching for the payment
        setAwaitingPayment(true);
        setBuying(false);
        void refreshBilling();
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      setBuyErr(err instanceof ApiError ? err.message : 'Could not open the checkout. Try again.');
      setBuying(false);
      void refreshBilling();
    }
  };

  const pro = billing?.pro === true;
  const firstMode = billing?.firstMonthEligible !== false;
  const waiting = awaitingPayment && me !== null && !pro;
  const price = offer?.priceUsd ?? 0;
  const first = offer?.firstMonthUsd ?? 0;
  const ctaLabel = firstMode ? `Go Pro — $${first} today` : `Go Pro — $${price}`;
  // Where "Reopen invoice" points: the newest checkout still waiting to be paid
  const openInvoiceUrl =
    billing?.payments.find(
      (p: ProPaymentDto) => (p.status === 'waiting' || p.status === 'created') && p.invoiceUrl,
    )?.invoiceUrl ?? null;

  const ctaButton = (label: string) => (
    <button style={{ ...CTA, ...(buying ? { background: 'color-mix(in srgb, var(--acc) 55%, transparent)' } : {}) }} onClick={() => void buy()} disabled={buying}>
      {buying ? (
        <>
          <InkSpinner />
          Opening invoice
        </>
      ) : (
        label
      )}
    </button>
  );

  /** The price card, playing whichever state the page is in */
  const card = () => {
    // 05 — Pro active: the card stops selling and starts reporting
    if (pro && billing?.paidUntil) {
      return (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--line2)', borderRadius: 'var(--r-xl)', padding: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--acc-text)', display: 'inline-flex' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.4l2.6 2.6L16 9.6" />
              </svg>
            </span>
            <span style={{ fontSize: 18, fontWeight: 'var(--fw-heavy)', letterSpacing: '-0.02em' }}>Pro is active</span>
          </div>
          <div className="mono" style={{ marginTop: 12, fontSize: 12, letterSpacing: '0.05em', color: 'var(--mut)' }}>
            PAID UNTIL{' '}
            <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
              {dateLong(billing.paidUntil).toUpperCase()}
            </span>
          </div>
          <button
            style={{ ...CTA, marginTop: 22, background: 'transparent', border: '1px solid var(--line2)', color: 'var(--text)' }}
            onClick={() => void buy()}
            disabled={buying}
          >
            {buying ? (
              <>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: '2px solid color-mix(in srgb, var(--text) 30%, transparent)',
                    borderTopColor: 'var(--text)',
                    display: 'inline-block',
                    animation: 'pro-spin 0.8s linear infinite',
                  }}
                />
                Opening invoice
              </>
            ) : (
              'Extend a month'
            )}
          </button>
          {buyErr ? <div style={{ marginTop: 10, fontSize: 12, color: 'var(--down)', textAlign: 'center' }}>{buyErr}</div> : null}
          <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: 'var(--mut)', textAlign: 'center' }}>
            Another month stacks on your paid-until date. ${price}.
          </div>
        </div>
      );
    }

    // 04 — the invoice is out there and the page is watching the chain
    if (waiting) {
      return (
        <div style={{ background: 'var(--surf)', border: '1px solid color-mix(in srgb, var(--acc) 40%, transparent)', borderRadius: 'var(--r-xl)', padding: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="pro-pulse" style={{ width: 8, height: 8, animationDuration: '1.4s' }} />
            <span className="mono" style={{ ...EYEBROW, color: 'var(--acc-text)' }}>WAITING FOR THE CHAIN</span>
          </div>
          <div style={{ marginTop: 14, fontSize: 18, fontWeight: 'var(--fw-heavy)', letterSpacing: '-0.02em', lineHeight: 1.3 }}>
            Invoice sent. Watching for the transfer.
          </div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--mut)' }}>
            Usually under a minute. Close the tab if you want — Telegram will confirm.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.05em', color: 'var(--mut)' }}>CHECKING EVERY 10S</span>
            {openInvoiceUrl ? (
              <a href={openInvoiceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 'var(--fw-bold)' }}>
                Reopen invoice
              </a>
            ) : null}
          </div>
        </div>
      );
    }

    // 01 / 02 — the sell: the first month leads while it applies; a renewal
    // after a lapse leads with the plain month instead
    if (!offer) {
      return (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--line2)', borderRadius: 'var(--r-xl)', padding: 26, fontSize: 13, color: 'var(--mut)' }}>
          The offer could not be loaded — refresh to try again.
        </div>
      );
    }
    return (
      <div style={{ background: 'var(--surf)', border: '1px solid var(--line2)', borderRadius: 'var(--r-xl)', padding: '34px 34px 30px', boxShadow: '0 30px 80px -40px color-mix(in srgb, var(--acc) 35%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="mono" style={EYEBROW}>{firstMode ? 'FIRST MONTH' : 'ONE PLAN'}</span>
          <span
            className="mono"
            style={{ fontSize: 11, fontWeight: 'var(--fw-medium)', letterSpacing: '0.05em', height: 24, padding: '0 11px', borderRadius: 'var(--r-full)', display: 'inline-flex', alignItems: 'center', background: 'var(--acc)', color: 'var(--acc-ink)' }}
          >
            &minus;{firstMode ? offer.firstMonthDiscountPct : offer.discountPct}%
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 18 }}>
          <span className="pro-price">${firstMode ? first : price}</span>
          <span className="mono" style={{ fontSize: 13, letterSpacing: '0.05em', color: 'var(--mut)' }}>
            {firstMode ? 'TODAY' : 'PER MONTH'}
          </span>
        </div>
        <div style={{ marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono" style={{ fontSize: 14, color: 'var(--mut)', textDecoration: 'line-through' }}>${offer.wasPriceUsd}</span>
            <span style={{ fontSize: 24, fontWeight: 'var(--fw-heavy)', letterSpacing: '-0.02em' }}>${price}</span>
            <span className="mono" style={{ fontSize: 12, letterSpacing: '0.05em', color: 'var(--mut)' }}>
              {firstMode ? '/ MONTH AFTER' : '/ MONTH'}
            </span>
          </div>
          {firstMode ? (
            <span
              className="mono"
              style={{ fontSize: 11, fontWeight: 'var(--fw-medium)', letterSpacing: '0.05em', height: 24, padding: '0 11px', border: '1px solid var(--line2)', borderRadius: 'var(--r-full)', display: 'inline-flex', alignItems: 'center', color: 'var(--text)' }}
            >
              &minus;{offer.discountPct}%
            </span>
          ) : null}
        </div>
        <div style={{ marginTop: 26 }}>{ctaButton(ctaLabel)}</div>
        {buyErr ? <div style={{ marginTop: 10, fontSize: 12, color: 'var(--down)', textAlign: 'center' }}>{buyErr}</div> : null}
        {buying ? (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--mut)', textAlign: 'center' }}>Opens in a new tab.</div>
        ) : !me ? (
          <div className="mono" style={{ marginTop: 14, textAlign: 'center', fontSize: 11, letterSpacing: '0.05em', color: 'var(--mut)' }}>
            TELEGRAM · X
          </div>
        ) : firstMode ? (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--mut)', textAlign: 'center' }}>
            then ${price}/month. Cancel by simply not renewing.
          </div>
        ) : (
          <div className="mono" style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8, fontSize: 11, letterSpacing: '0.05em', color: 'var(--mut)' }}>
            <span>CRYPTO</span>
            <span style={{ color: 'var(--line2)' }}>·</span>
            <span>NO CARD</span>
            <span style={{ color: 'var(--line2)' }}>·</span>
            <span>NO AUTO-RENEW</span>
          </div>
        )}
      </div>
    );
  };

  /** 06 — the payment history, when there is any */
  const paymentsCard = () =>
    me && billing && billing.payments.length > 0 ? (
      <div style={{ background: 'var(--surf)', border: '1px solid var(--line2)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
        {billing.payments.slice(0, 6).map((p) => (
          <div
            key={p.id}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 80px 120px', alignItems: 'center', gap: 10, padding: '15px 22px', borderBottom: '1px solid var(--line)' }}
          >
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--mut)' }}>{dateRow(p.createdAt)}</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 'var(--fw-medium)', textAlign: 'right' }}>
              ${p.priceUsd.toFixed(2)}
            </span>
            {p.status === 'paid' ? (
              <span
                className="mono"
                style={{ fontSize: 11, fontWeight: 'var(--fw-medium)', letterSpacing: '0.05em', height: 24, padding: '0 11px', borderRadius: 'var(--r-full)', display: 'inline-flex', alignItems: 'center', justifySelf: 'end', background: 'var(--acc-soft)', color: 'var(--acc-text)' }}
              >
                PAID
              </span>
            ) : p.invoiceUrl ? (
              <a href={p.invoiceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 'var(--fw-bold)', justifySelf: 'end' }}>
                Finish paying
              </a>
            ) : (
              <span
                className="mono"
                style={{ fontSize: 11, letterSpacing: '0.05em', height: 24, padding: '0 11px', border: '1px solid var(--line2)', borderRadius: 'var(--r-full)', display: 'inline-flex', alignItems: 'center', justifySelf: 'end', color: 'var(--mut)' }}
              >
                {p.status.toUpperCase()}
              </span>
            )}
          </div>
        ))}
      </div>
    ) : null;

  const tiles = offer
    ? [
        { label: 'PORTFOLIOS', pro: 'Unlimited', free: `${offer.limits.freePortfolios}`, soon: false },
        { label: 'WALLETS / PORTFOLIO', pro: 'Unlimited', free: `${offer.limits.freeWalletsPerPortfolio}`, soon: false },
        { label: 'CHART HISTORY', pro: 'All of it', free: `${offer.limits.freeHistoryDays} days`, soon: false },
        { label: 'TELEGRAM ALERTS', pro: 'Unlimited', free: `first ${offer.limits.freeAlerts}`, soon: false },
        { label: 'AGENT QUESTIONS', pro: 'Unlimited', free: `${offer.limits.freeAiPerDay} a day`, soon: true },
      ]
    : [];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        className="pro-pad app-header"
        style={{ minHeight: 64, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <Link href="/" aria-label="svinooh home" style={{ display: 'flex', color: 'inherit', textDecoration: 'none' }}>
            <Logo size={21} />
          </Link>
          <nav className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13, fontWeight: 'var(--fw-medium)', color: 'var(--mut)' }}>
            <Link href={me ? `/p/${me.portfolioSlug}` : '/'} style={{ color: 'inherit', textDecoration: 'none' }}>
              Portfolios
            </Link>
            <span style={{ color: 'var(--text)' }}>Pro</span>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ThemeToggle />
          {me ? (
            <Link
              href={`/p/${me.portfolioSlug}`}
              style={{ height: 34, padding: '0 18px', border: '1px solid var(--line2)', borderRadius: 'var(--r-full)', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 'var(--fw-bold)', color: 'var(--text)', textDecoration: 'none' }}
            >
              My portfolio
            </Link>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              style={{ height: 34, padding: '0 18px', border: '1px solid var(--line2)', background: 'transparent', borderRadius: 'var(--r-full)', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 'var(--fw-bold)', color: 'var(--text)' }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <main style={{ flex: 1 }}>
        <section className="pro-dots">
          <div className="pro-fade" />
          <div className="pro-hero">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="pro-pulse" />
                <span className="mono" style={EYEBROW}>SVINOOH.PRO</span>
              </div>
              <h1 className="pro-h1">
                Every limit,
                <br />
                <span style={{ color: 'var(--acc-text)' }}>gone.</span>
              </h1>
              <p className="pro-lede">
                Unlimited portfolios and wallets. The full history of every address. Alerts that
                never stop.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {card()}
              {paymentsCard()}
            </div>
          </div>
        </section>

        {tiles.length > 0 ? (
          <section className="pro-pad" style={{ paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 20 }}>
              <span className="mono" style={EYEBROW}>WHAT PRO UNLOCKS</span>
              <span className="mono hide-mobile" style={EYEBROW}>FREE STAYS FREE</span>
            </div>
            <div className="pro-tiles">
              {tiles.map((t) => (
                <div key={t.label} className="pro-tile">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span className="mono" style={{ ...EYEBROW, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
                    {t.soon ? (
                      <span
                        className="mono"
                        style={{ fontSize: 10, letterSpacing: '0.05em', height: 20, padding: '0 8px', border: '1px solid var(--line2)', borderRadius: 'var(--r-full)', display: 'inline-flex', alignItems: 'center', color: 'var(--mut)' }}
                      >
                        SOON
                      </span>
                    ) : null}
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                    <span className="pro-tile-value">{t.pro}</span>
                  </div>
                  <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--mut)' }}>
                    <span style={{ letterSpacing: '0.12em', fontSize: 10 }}>FREE</span>
                    <span style={{ textDecoration: 'line-through', color: 'var(--text)', opacity: 0.55 }}>{t.free}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!pro && offer ? (
          <section className="pro-pad" style={{ paddingTop: 64, paddingBottom: 80 }}>
            <div className="pro-closer">
              <div>
                <div className="pro-closer-head">Start with ${first} today.</div>
                <div style={{ marginTop: 10, fontSize: 15, color: 'var(--mut)' }}>
                  Then ${price} a month, paid in crypto. No auto-renew — stop by simply not paying.
                </div>
              </div>
              <div className="pro-closer-cta" style={{ minWidth: 220 }}>
                {ctaButton(ctaLabel)}
              </div>
            </div>
          </section>
        ) : (
          <div style={{ paddingBottom: 64 }} />
        )}
      </main>

      {!pro && !waiting && offer ? <div className="pro-sticky">{ctaButton(ctaLabel)}</div> : null}

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
