'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PortfolioDto, PublicPortfolioDto } from '@svinooh/shared';
import { AccountMenu } from '../components/AccountMenu';
import { AnimatedUsd } from '../components/AnimatedUsd';
import { AuthModal } from '../components/AuthModal';
import { ChainMarquee } from '../components/ChainMarquee';
import { HeroComposer, type HeroComposerHandle } from '../components/marketing/HeroComposer';
import { YieldReplay } from '../components/marketing/YieldReplay';
import { Logo } from '../components/Logo';
import { Button, Card } from '../ui';
import { Sparkline } from '../components/Sparkline';
import { ThemeToggle } from '../components/ThemeToggle';
import { track } from '../lib/analytics';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { parkQuestion } from '../lib/handoff';
import { fmtUsd0, portfolioLabel } from '../lib/format';
import { EMPTY_LANDING, loadLandingData, preloadedLanding, type LandingData } from '../lib/landing-data';
import { useReplay } from '../lib/replay';
import { SiteFooter } from '../components/SiteFooter';

/**
 * The front door, and the product's first screen.
 *
 * The field in the hero is the app's composer, not a picture of one: what is
 * typed there is the first message of a real conversation, and sending it
 * carries the page into the chat with the question already asked. Which is why
 * there is no "create an account" step in front of anything here — the account
 * is offered after the first answer, when there is something worth keeping.
 *
 * Everything below the composer is the same claim said four ways: every
 * network, every position, what the rest of the chain is doing, and who is
 * already here. The numbers in the portfolio card and the list are real and
 * public; the yield card is an illustration and says so in its own module.
 */

/** How long the page has to lift and fade before the chat takes the screen. */
const LEAVE_MS = 420;

const ARROW = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * The eyebrow over a section — and the section's heading.
 *
 * Same signage to the eye as every other eyebrow in the product, a real h2 to
 * anything reading the page's outline. The kit's Eyebrow draws a div, so this
 * borrows its class and states the two things a heading has to undo: the
 * browser's margin and its bold.
 */
function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="ui-eyebrow" style={{ margin: 0, fontWeight: 400, letterSpacing: '0.18em' }}>
      {children}
    </h2>
  );
}

/**
 * The rhythm sections 5 to 8 share: the same air above each of them.
 *
 * paddingTop rather than a `padding` shorthand, because these go on `.shell`
 * elements and the shorthand would wipe the gutters that class supplies.
 */
const SECTION = { paddingTop: 'clamp(48px,7vw,88px)' } as const;

const HEADLINE = {
  fontWeight: 'var(--fw-heavy)',
  fontSize: 'clamp(26px,3.6vw,40px)',
  letterSpacing: '-0.035em',
  lineHeight: 1.08,
} as const;

const LEDE = {
  fontSize: 'var(--fs-read)',
  lineHeight: 1.6,
  color: 'var(--mut)',
  margin: '14px 0 0',
  maxWidth: 380,
  textWrap: 'pretty',
} as const;

export function Landing({ preloaded: fromServer }: { preloaded?: LandingData } = {}) {
  const { me, logout } = useAuth();
  const router = useRouter();

  // The server rendered this page with data already in it; starting from the
  // same data is what makes hydration silent instead of a second first paint.
  const preloaded = fromServer ?? preloadedLanding() ?? EMPTY_LANDING;

  const [authOpen, setAuthOpen] = useState(false);
  const [pubs, setPubs] = useState<PublicPortfolioDto[]>(preloaded.pubs);
  const [demo, setDemo] = useState<PortfolioDto | null>(preloaded.demo);
  const [demoHistory, setDemoHistory] = useState(preloaded.history);
  /** Set for the length of the hand-off: the page lifts and the chat arrives. */
  const [leaving, setLeaving] = useState(false);
  const composer = useRef<HeroComposerHandle | null>(null);

  /**
   * The list is checked against the API on every load, whether or not the page
   * arrived with one in it. The page is a cached one — rebuilt at most once a
   * minute — and this list is the one thing on it that says who is visible. A
   * portfolio taken private has to leave the moment it is taken private, and
   * skipping this because the HTML already had a list is what kept it on screen
   * for as long as the tab stayed open.
   *
   * The card underneath is only swapped when it is a different portfolio. The
   * same one with its numbers a minute newer is not worth restarting the replay
   * for, and that is the movement this used to skip the fetch to avoid.
   */
  useEffect(() => {
    void loadLandingData((path) => api(path))
      .then((data) => {
        setPubs(data.pubs);
        if (data.demo?.slug !== preloaded.demo?.slug) {
          setDemo(data.demo);
          setDemoHistory(data.history);
        }
      })
      .catch(() => {});
    // Once, on mount: `preloaded` never changes within a page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The hand-off.
   *
   * The question is parked in the tab rather than put in the URL — see
   * lib/handoff, and the first thing a lot of people will type here is a
   * wallet address. Then the page lifts and fades, and /ai mounts under it
   * with the question already in the log.
   */
  const send = (text: string) => {
    if (leaving) return;
    parkQuestion(text);
    track('landing_asked', {});
    setLeaving(true);
    window.setTimeout(() => router.push('/ai'), LEAVE_MS);
  };

  const demoPositions = useMemo(() => {
    if (!demo) return [];
    return demo.wallets
      .flatMap((w) => w.positions)
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 3);
  }, [demo]);

  // On arrival the card walks through the portfolio's most recent moves, then
  // settles on where it actually stands. Only the digits that differ between
  // two steps move, so what you read is what changed.
  const series = demoHistory?.values ?? [];
  const replay = useReplay(series);
  const current = demo?.totalUsd ?? pubs[0]?.totalUsd ?? 0;
  // Once the replay has caught up it must rest on what the portfolio is worth
  // now, not on the last plotted point — history is bucketed and smoothed, so
  // the two are near but not equal.
  const total = replay.live || !series.length ? current : series[replay.index];
  const change = (() => {
    if (series.length < 2) return null;
    const first = series[0];
    const chg = total - first;
    return { pct: first ? (chg / first) * 100 : 0, up: chg >= 0 };
  })();

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        // The whole page is what leaves, in one movement, so the chat arriving
        // reads as the same surface rather than a second page.
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(-22px) scale(0.985)' : 'none',
        transition: `opacity ${LEAVE_MS}ms ease, transform ${LEAVE_MS}ms ease`,
        // Nothing to press on a page that is leaving: it is still on screen
        // and still clickable while it fades, and a link caught in that
        // moment would be navigated to and then pushed off by the chat.
        pointerEvents: leaving ? 'none' : undefined,
      }}
    >
      {/* min-height, not height: the safe-area padding has to grow the row
          rather than eat into it — see .app-header */}
      <header
        className="shell app-header"
        style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Logo size={19} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle />
          {me ? (
            <AccountMenu
              name={me.name}
              username={me.username}
              photoUrl={me.photoUrl}
              onPro={() => router.push('/pro')}
              onExit={logout}
            />
          ) : (
            <Button size="sm" onClick={() => setAuthOpen(true)}>
              Sign in
            </Button>
          )}
        </div>
      </header>

      {/* The landmark takes no part in the layout: display contents hands its
          children straight to the flex column above */}
      <main style={{ display: 'contents' }}>
        <div className="shell" style={{ paddingTop: 'clamp(30px,5vw,64px)', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontWeight: 'var(--fw-heavy)', fontSize: 'clamp(32px,6vw,64px)', letterSpacing: '-0.045em', lineHeight: 1.04 }}>
            Your <span style={{ color: 'var(--acc-text)' }}>DeFi-Copilot</span>
          </h1>
          <p style={{ maxWidth: 540, margin: '16px auto 0', fontSize: 'clamp(14px,1.5vw,16px)', lineHeight: 1.6, color: 'var(--mut)', textWrap: 'pretty' }}>
            One agent that reads every position across 50+ chains, tells you what matters — and soon
            moves the money with your signature.
          </p>
        </div>

        <HeroComposer onSend={send} handle={composer} />

        <ChainMarquee />

        {/* Every DeFi position — said beside a real public portfolio. */}
        <div className="shell sv-l-split" style={SECTION}>
          <div>
            <SectionEyebrow>PORTFOLIO</SectionEyebrow>
            <div style={{ ...HEADLINE, marginTop: 14 }}>
              Every DeFi position.
              <br />
              <span style={{ color: 'var(--acc-text)' }}>No exceptions.</span>
            </div>
            <p style={LEDE}>LP, lending, staking, farming. Every wallet, one link.</p>
          </div>
          <Card style={{ overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 0' }}>
              {/* The portfolio's own name, never its owner's */}
              <span className="mono" style={{ fontSize: 'var(--fs-tag)', letterSpacing: '0.14em', color: 'var(--mut)' }}>
                {demo ? `${portfolioLabel(demo.name, demo.slug).toUpperCase()} · PUBLIC` : 'PUBLIC'}
              </span>
            </div>
            <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <AnimatedUsd
                className="mono"
                value={total}
                style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-hero)', letterSpacing: '-0.02em' }}
              />
              {change ? (
                <span
                  className="mono"
                  style={{ fontSize: 'var(--fs-control)', fontWeight: 'var(--fw-medium)', color: change.up ? 'var(--up)' : 'var(--down)' }}
                >
                  {(change.up ? '+' : '') + change.pct.toFixed(2)}% · 7D
                </span>
              ) : null}
            </div>
            <div style={{ padding: '4px 0 0' }}>
              <Sparkline values={series} height={120} />
            </div>
            {demoPositions.map((p) => (
              <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.symbol}
                  {p.name && p.name !== p.symbol ? ` · ${p.name}` : ''}
                </div>
                <span className="mono" style={{ fontSize: 'var(--fs-tag)', letterSpacing: '0.12em', color: 'var(--mut)' }}>
                  {p.category === 'staked' ? 'STAKING' : p.category === 'defi' ? 'DEFI' : 'TOKEN'}
                </span>
                <span className="mono" style={{ fontSize: 'var(--fs-control)', fontWeight: 'var(--fw-medium)' }}>
                  {fmtUsd0(p.valueUsd)}
                </span>
              </div>
            ))}
          </Card>
        </div>

        {/* The other square of the checkerboard: the card leads on a desktop,
            the text still comes first in the markup — see .sv-l-split. */}
        <div className="shell sv-l-split" data-lead="card" style={SECTION}>
          <div>
            <SectionEyebrow>ON-CHAIN INSIGHTS</SectionEyebrow>
            <div style={{ ...HEADLINE, marginTop: 14 }}>
              It reads the whole chain,
              <br />
              not just your wallets.
            </div>
            <p style={LEDE}>Where yield is moving. What the best LPs do differently.</p>
            {/* A question, phrased as one, that goes where every other question
                on this page goes. */}
            <button
              type="button"
              onClick={() => send('where are the best LPs putting USDC?')}
              className="mono"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                marginTop: 22,
                height: 40,
                padding: '0 8px 0 16px',
                borderRadius: 'var(--r-full)',
                border: '1px solid var(--line2)',
                background: 'transparent',
                color: 'var(--text)',
                fontSize: 'var(--fs-note)',
                textAlign: 'left',
                transition: 'border-color .2s',
              }}
            >
              where are the best LPs putting USDC?
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--acc)', color: 'var(--acc-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" {...ARROW} aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          </div>
          <YieldReplay />
        </div>

        {/* Who is already here. Real, public, and sorted by what they hold. */}
        <div className="shell" style={SECTION}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <SectionEyebrow>PUBLIC PORTFOLIOS</SectionEyebrow>
            <div className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)' }}>
              {pubs.length} · BY VALUE
            </div>
          </div>
          <Card style={{ position: 'relative', marginTop: 14, overflow: 'hidden' }}>
            <div style={{ maxHeight: 328, overflowY: 'auto' }}>
              {pubs.length === 0 ? (
                <div className="mono" style={{ padding: '28px 16px', textAlign: 'center', fontSize: 'var(--fs-note)', color: 'var(--mut)' }}>
                  No public portfolios yet — be the first.
                </div>
              ) : (
                pubs.map((p, i) => (
                  <Link
                    key={p.slug}
                    href={`/p/${p.slug}`}
                    className="row-hover"
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderTop: i ? '1px solid var(--line)' : 'none', color: 'inherit', textDecoration: 'none' }}
                  >
                    <span className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)', width: 22, flexShrink: 0 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {/* The portfolio's own identity and its wallets — never who owns them. */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className={p.name ? undefined : 'mono'}
                        style={{
                          fontWeight: p.name ? 'var(--fw-bold)' : 'var(--fw-medium)',
                          // A name is set in sans and a slug in mono (see the class
                          // above); mono runs a step smaller for the same optical size
                          fontSize: p.name ? 'var(--fs-read)' : 'var(--fs-body)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {portfolioLabel(p.name, p.slug)}
                      </div>
                      <div className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', marginTop: 3 }}>
                        {p.walletCount} {p.walletCount === 1 ? 'wallet' : 'wallets'} · {p.chains.join(', ') || '—'}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)', minWidth: 80, textAlign: 'right' }}>
                      {fmtUsd0(p.totalUsd)}
                    </span>
                  </Link>
                ))
              )}
            </div>
            <div style={{ position: 'absolute', left: 1, right: 1, bottom: 0, height: 30, background: 'linear-gradient(to top, var(--surf), transparent)', pointerEvents: 'none' }} />
          </Card>
        </div>

        {/* The way back up to the field, for somebody who read the whole page. */}
        <div className="shell" style={{ paddingTop: 'clamp(48px,7vw,88px)', paddingBottom: 'clamp(36px,5vw,56px)' }}>
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-xl)',
              background: 'var(--surf)',
              padding: 'clamp(30px,5vw,52px) 24px',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', inset: '-40%', background: 'radial-gradient(ellipse at 50% 130%, var(--acc-soft), transparent 60%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative' }}>
              <div style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'clamp(22px,4vw,34px)', letterSpacing: '-0.03em' }}>
                Compound your DeFi with AI.
              </div>
              <div
                className="mono"
                style={{ fontSize: 'var(--fs-tag)', letterSpacing: '0.14em', color: 'var(--mut)', marginTop: 14, display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}
              >
                <span>AI INSIGHTS</span>
                <span style={{ color: 'var(--line2)' }}>·</span>
                <span>ONE CHAT</span>
                <span style={{ color: 'var(--line2)' }}>·</span>
                <span>YOUR KEYS</span>
              </div>
              <Button size="lg" style={{ marginTop: 22 }} onClick={() => composer.current?.focus()}>
                Ask the agent
              </Button>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
