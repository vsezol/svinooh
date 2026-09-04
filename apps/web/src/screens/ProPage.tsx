'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BillingMeDto, ProOfferDto } from '@svinooh/shared';
import { AuthModal } from '../components/AuthModal';
import { Logo } from '../components/Logo';
import { ProPrice } from '../components/Paywall';
import { ThemeToggle } from '../components/ThemeToggle';
import { track } from '../lib/analytics';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getBillingMe, getOffer, startCheckout } from '../lib/billing';
import { Button, Card, Eyebrow, Note, Spinner, Tag, Title } from '../ui';

/**
 * The marketing page: the offer, what Pro removes, how paying in crypto
 * works, and — for the signed-in — where their subscription stands.
 *
 * Every number on it comes off the server (the offer is operator-tunable), so
 * the page can never advertise a price the checkout would contradict. The
 * offer arrives prerendered from the route and is refreshed in the browser,
 * the same shape as the landing.
 */
export function ProPage({ preloaded }: { preloaded: ProOfferDto | null }) {
  const router = useRouter();
  const { me, loading: authLoading } = useAuth();
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

  useEffect(() => {
    if (!awaitingPayment || !me || billing?.pro) return;
    const timer = setInterval(() => void refreshBilling(), 5000);
    return () => clearInterval(timer);
  }, [awaitingPayment, me, billing?.pro, refreshBilling]);

  const buy = async () => {
    if (buying) return;
    if (!me) {
      setAuthOpen(true);
      return;
    }
    setBuying(true);
    setBuyErr(null);
    track('checkout_opened', { firstMonth: billing?.firstMonthEligible ?? true });
    try {
      await startCheckout(); // navigates away on success
    } catch (err) {
      setBuyErr(err instanceof ApiError ? err.message : 'Could not open the checkout. Try again.');
      setBuying(false);
    }
  };

  const pro = billing?.pro === true;
  const until = billing?.paidUntil ? billing.paidUntil.slice(0, 10) : null;
  const buyLabel = !me
    ? 'Sign in to go Pro'
    : pro
      ? 'Extend a month'
      : billing?.firstMonthEligible !== false && offer
        ? `Go Pro — $${offer.firstMonthUsd} today`
        : offer
          ? `Go Pro — $${offer.priceUsd}`
          : 'Go Pro';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        className="shell app-header"
        style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Link href="/" aria-label="svinooh home" style={{ display: 'flex', color: 'inherit' }}>
          <Logo size={19} />
        </Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          <Button
            size="sm"
            variant="quiet"
            onClick={() => (me ? router.push(`/p/${me.portfolioSlug}`) : setAuthOpen(true))}
          >
            {me ? 'My portfolio' : 'Sign in'}
          </Button>
        </div>
      </div>

      <div
        className="shell"
        style={{
          width: '100%',
          maxWidth: 900,
          margin: '0 auto',
          padding: 'clamp(28px,5vw,56px) clamp(14px,3.5vw,28px) 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-7)',
        }}
      >
        {awaitingPayment && me && !pro ? (
          <Card style={{ padding: '15px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Spinner size={14} />
              <Note>
                Payment received on the gateway side — Pro switches on the moment the network
                confirms it. This page is checking every few seconds; the bot will also say so in
                Telegram.
              </Note>
            </div>
          </Card>
        ) : null}

        {/* the pitch */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
            gap: 'clamp(24px,4vw,44px)',
            alignItems: 'center',
          }}
        >
          <div>
            <Eyebrow>SVINOOH.PRO</Eyebrow>
            <div
              style={{
                marginTop: 10,
                fontWeight: 'var(--fw-heavy)',
                fontSize: 'clamp(var(--fs-hero),4vw,44px)',
                letterSpacing: '-0.04em',
                lineHeight: 1.1,
              }}
            >
              Every limit, <span style={{ color: 'var(--acc-text)' }}>gone.</span>
            </div>
            <div
              style={{
                maxWidth: 430,
                marginTop: 14,
                fontSize: 'var(--fs-lead)',
                lineHeight: 1.6,
                color: 'var(--mut)',
                textWrap: 'pretty',
              }}
            >
              As many portfolios and wallets as you track, the whole history of every address, and
              alerts that never run out — for less than a coffee a month.
            </div>
          </div>

          <Card style={{ padding: '20px 22px' }}>
            {pro && until ? (
              <div>
                <Title>Pro is active</Title>
                <Note style={{ marginTop: 8 }}>
                  Paid until <b style={{ color: 'var(--fg)' }}>{until}</b>. Extending now adds a
                  month on top — nothing is lost by paying early.
                </Note>
              </div>
            ) : offer ? (
              <ProPrice offer={offer} headline="One plan, one price" />
            ) : (
              <Note>The offer could not be loaded — refresh to try again.</Note>
            )}
            <div style={{ marginTop: 18 }}>
              <Button size="lg" style={{ width: '100%' }} onClick={() => void buy()} disabled={buying}>
                {buying ? <Spinner size={15} /> : buyLabel}
              </Button>
              {buyErr ? <Note style={{ marginTop: 8, color: 'var(--down)' }}>{buyErr}</Note> : null}
              <Note style={{ marginTop: 10 }}>
                Paid in crypto — USDT, TON, SOL, BTC and more, any wallet or exchange. No card, no
                auto-debit: a month is yours because you paid for it.
              </Note>
            </div>
          </Card>
        </div>

        {/* what the money buys */}
        {offer ? (
          <Card style={{ padding: '18px 22px' }}>
            <Eyebrow>WHAT CHANGES</Eyebrow>
            <div style={{ marginTop: 12 }}>
              {[
                ['Portfolios', `${offer.limits.freePortfolios}`, 'Unlimited'],
                ['Wallets per portfolio', `${offer.limits.freeWalletsPerPortfolio}`, 'Unlimited'],
                ['History on the charts', `${offer.limits.freeHistoryDays} days`, 'All of it'],
                ['Telegram alerts', `first ${offer.limits.freeAlerts}`, 'Unlimited'],
                [
                  'Agent questions (soon)',
                  `${offer.limits.freeAiPerDay} a day`,
                  'Unlimited',
                ],
              ].map(([what, free, paid]) => (
                <div
                  key={what}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap: 'var(--sp-5)',
                    alignItems: 'baseline',
                    padding: '9px 0',
                    borderTop: '1px solid var(--line)',
                  }}
                >
                  <span style={{ fontSize: 'var(--fs-body)' }}>{what}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 'var(--fs-note)', color: 'var(--mut)', textAlign: 'right' }}
                  >
                    {free}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 'var(--fs-note)',
                      color: 'var(--acc-text)',
                      fontWeight: 'var(--fw-bold)',
                      minWidth: 84,
                      textAlign: 'right',
                    }}
                  >
                    {paid}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* how paying works — crypto has rules of its own, said up front */}
        <Card style={{ padding: '18px 22px' }}>
          <Eyebrow>HOW PAYING WORKS</Eyebrow>
          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            <Note style={{ lineHeight: 1.6 }}>
              The button opens a hosted invoice (NOWPayments). Pick a coin and network there — the
              cheap rails all work — send the exact amount, and Pro switches on as soon as the
              network confirms it, usually within a minute or two.
            </Note>
            <Note style={{ lineHeight: 1.6 }}>
              Every payment buys one calendar month and stacks on your paid-until date. There is no
              auto-debit in crypto and we do not pretend otherwise: three days before the end the
              bot reminds you in Telegram, and renewing is one more invoice.
            </Note>
            <Note style={{ lineHeight: 1.6 }}>
              If Pro lapses, nothing is deleted — portfolios, wallets and history all stay exactly
              where you left them, back behind the free limits until you return.
            </Note>
          </div>
        </Card>

        {/* the signed-in view of their own money */}
        {me && billing && billing.payments.length > 0 ? (
          <Card style={{ padding: '18px 22px' }}>
            <Eyebrow>YOUR PAYMENTS</Eyebrow>
            <div style={{ marginTop: 8 }}>
              {billing.payments.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--sp-5)',
                    padding: '8px 0',
                    borderTop: '1px solid var(--line)',
                    fontSize: 'var(--fs-note)',
                  }}
                >
                  <span className="mono" style={{ color: 'var(--mut)' }}>
                    {p.createdAt.slice(0, 10)}
                  </span>
                  <span className="mono">${p.priceUsd}</span>
                  <span style={{ flex: 1 }} />
                  {p.status === 'paid' ? (
                    <Tag variant="soft">paid</Tag>
                  ) : p.invoiceUrl ? (
                    <a href={p.invoiceUrl} style={{ color: 'var(--acc-text)' }}>
                      Finish paying
                    </a>
                  ) : (
                    <Tag variant="outline">{p.status}</Tag>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {!authLoading && !me ? (
          <Note style={{ textAlign: 'center' }}>
            Pro attaches to an account — sign in with Telegram or X first, it takes ten seconds.
          </Note>
        ) : null}
      </div>

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
