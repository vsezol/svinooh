'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PortfolioDto, PublicPortfolioDto } from '@svinooh/shared';
import { AnimatedUsd } from '../components/AnimatedUsd';
import { AuthModal } from '../components/AuthModal';
import { ChainMarquee } from '../components/ChainMarquee';
import { Logo } from '../components/Logo';
import { SearchDropdown } from '../components/SearchDropdown';
import { Button, Card, Eyebrow, Input } from '../ui';
import { Sparkline } from '../components/Sparkline';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtUsd0, portfolioLabel } from '../lib/format';
import { EMPTY_LANDING, loadLandingData, preloadedLanding, type LandingData } from '../lib/landing-data';
import { useReplay } from '../lib/replay';


export function Landing({ preloaded: fromServer }: { preloaded?: LandingData } = {}) {
  const { me } = useAuth();
  const router = useRouter();

  // The server rendered this page with data already in it; starting from the
  // same data is what makes hydration silent instead of a second first paint.
  // Passed in when this *is* the server render, read back off the page when the
  // browser picks it up.
  const preloaded = fromServer ?? preloadedLanding() ?? EMPTY_LANDING;

  const [authOpen, setAuthOpen] = useState(false);
  const [pubs, setPubs] = useState<PublicPortfolioDto[]>(preloaded.pubs);
  const [demo, setDemo] = useState<PortfolioDto | null>(preloaded.demo);
  const [demoHistory, setDemoHistory] = useState(preloaded.history);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PublicPortfolioDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackErr, setTrackErr] = useState<string | null>(null);

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

  // Typing searches on the server and fills the dropdown under the input: an
  // anonymous portfolio is found by the wallet address it holds, which the
  // client never sees in the list payload.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      void api<PublicPortfolioDto[]>(`/portfolios/public?limit=6&q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);

  // Anything long enough to be an address is offered as "track this" — the
  // backend is the one that decides whether the network is recognized
  const looksLikeAddress = /^[A-Za-z0-9]{26,64}$/.test(search.trim());

  const trackAddress = async () => {
    if (tracking) return;
    setTracking(true);
    setTrackErr(null);
    try {
      const { slug } = await api<{ slug: string }>('/portfolios/anonymous', {
        method: 'POST',
        body: JSON.stringify({ address: search.trim() }),
      });
      setOpen(false);
      router.push(`/p/${slug}`);
    } catch (err) {
      setTrackErr(err instanceof ApiError ? err.message : 'Could not open this address');
    } finally {
      setTracking(false);
    }
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

  const primary = () => (me ? router.push(`/p/${me.portfolioSlug}`) : setAuthOpen(true));
  const primaryLabel = me ? 'My portfolio' : 'Create portfolio';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      {/* min-height, not height: the safe-area padding has to grow the row
          rather than eat into it — see .app-header */}
      <div
        className="shell app-header"
        style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Logo size={19} />
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          <Button size="sm" onClick={primary}>
            {primaryLabel}
          </Button>
        </div>
      </div>

      {/* hero */}
      <div
        className="shell"
        style={{
          flex: 1,
          width: '100%',
          padding: 'clamp(36px,6vw,80px) clamp(14px,3.5vw,28px) clamp(28px,4vw,48px)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
          gap: 'clamp(28px,5vw,60px)',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'clamp(var(--fs-hero),4.6vw,52px)', letterSpacing: '-0.04em', lineHeight: 1.08 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Every DeFi position.</span>
            <br />
            <span style={{ color: 'var(--acc-text)', whiteSpace: 'nowrap' }}>No exceptions.</span>
          </div>
          <div style={{ maxWidth: 430, marginTop: 18, fontSize: 'var(--fs-lead)', lineHeight: 1.65, color: 'var(--mut)', textWrap: 'pretty' }}>
            Tokens, LP, staking, lending, farming — the DeFi positions other trackers miss, counted at full value.
          </div>
          <div style={{ marginTop: 26, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Typing opens a dropdown of matches right here, rather than
                quietly re-filtering a list further down the page. */}
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
              <Input
                mono
                className="hide-mobile"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOpen(true);
                  setTrackErr(null);
                }}
                onFocus={() => setOpen(true)}
                // A click inside the dropdown blurs the input first, so closing
                // is deferred long enough for that click to land
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'Enter' && looksLikeAddress) void trackAddress();
                }}
                placeholder="Search a portfolio id or paste a wallet address"
                aria-label="Search portfolios"
                spellCheck={false}
              />
              {open && search.trim() ? (
                <SearchDropdown
                  results={results}
                  looksLikeAddress={looksLikeAddress}
                  tracking={tracking}
                  error={trackErr}
                  onPick={(slug) => {
                    setOpen(false);
                    router.push(`/p/${slug}`);
                  }}
                  onTrack={() => void trackAddress()}
                />
              ) : null}
            </div>
            <Button size="lg" onClick={primary}>
              {primaryLabel}
            </Button>
          </div>
        </div>

        {/* demo card from the top public portfolio */}
        <div>
          <Card style={{ overflow: 'hidden', boxShadow: '0 30px 80px -40px color-mix(in srgb, var(--acc) 35%, transparent)' }}>
            <div style={{ padding: '15px 18px 0' }}>
              {/* The portfolio's own name, never its owner's */}
              <span className="mono" style={{ fontSize: 'var(--fs-micro)', letterSpacing: '0.14em', color: 'var(--mut)' }}>
                {demo ? `${portfolioLabel(demo.name, demo.slug).toUpperCase()} · PUBLIC` : 'PUBLIC'}
              </span>
            </div>
            <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <AnimatedUsd
                className="mono"
                value={total}
                style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-hero)', letterSpacing: '-0.02em' }}
              />
              {change ? (
                <span
                  className="mono"
                  style={{ fontSize: 'var(--fs-note)', fontWeight: 'var(--fw-medium)', color: change.up ? 'var(--up)' : 'var(--down)' }}
                >
                  {(change.up ? '+' : '') + change.pct.toFixed(2)}% · 30D
                </span>
              ) : null}
            </div>
            <div style={{ padding: '10px 0 0' }}>
              <Sparkline values={demoHistory?.values ?? []} height={132} />
            </div>
            {demoPositions.map((p) => (
              <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-note)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.symbol}
                  {p.name && p.name !== p.symbol ? ` · ${p.name}` : ''}
                </div>
                <span className="mono" style={{ fontSize: 'var(--fs-micro)', letterSpacing: '0.12em', color: 'var(--mut)' }}>
                  {p.category === 'staked' ? 'STAKING' : p.category === 'defi' ? 'DEFI' : 'TOKEN'}
                </span>
                <span className="mono" style={{ fontSize: 'var(--fs-note)', fontWeight: 'var(--fw-medium)' }}>
                  {fmtUsd0(p.valueUsd)}
                </span>
              </div>
            ))}
            {demo ? (
              <div
                onClick={() => router.push(`/p/${demo.slug}`)}
                className="row-hover mono"
                style={{ borderTop: '1px solid var(--line)', padding: '11px 18px', textAlign: 'center', fontSize: 'var(--fs-micro)', letterSpacing: '0.12em', color: 'var(--acc-text)', cursor: 'pointer', userSelect: 'none' }}
              >
                OPEN THIS PORTFOLIO →
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      <ChainMarquee />

      {/* public portfolios */}
      <div className="shell" style={{ width: '100%', padding: '36px clamp(14px,3.5vw,28px) 52px' }}>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <Eyebrow>PUBLIC PORTFOLIOS</Eyebrow>
            <div className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)' }}>
              {pubs.length} {pubs.length === 1 ? 'PORTFOLIO' : 'PORTFOLIOS'}
            </div>
          </div>
          {/* A plain list of what is public. Searching happens in the dropdown
              under the hero input, so this one never shifts under you. */}
          <Card style={{ position: 'relative', marginTop: 14, overflow: 'hidden' }}>
            <div style={{ maxHeight: 328, overflowY: 'auto' }}>
              {pubs.length === 0 ? (
                <div className="mono" style={{ padding: '28px 16px', textAlign: 'center', fontSize: 'var(--fs-note)', color: 'var(--mut)' }}>
                  No public portfolios yet — be the first.
                </div>
              ) : (
                pubs.map((p, i) => (
                  <div
                    key={p.slug}
                    onClick={() => router.push(`/p/${p.slug}`)}
                    className="row-hover"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer' }}
                  >
                    <span className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)', width: 22, flexShrink: 0 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {/* The portfolio's own identity and its wallets — never who owns them. */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className={p.name ? undefined : 'mono'}
                        style={{
                          fontWeight: 'var(--fw-bold)',
                          // A name is set in sans and a slug in mono (see the class
                          // above); mono runs a step smaller for the same optical size
                          fontSize: p.name ? 'var(--fs-body)' : 'var(--fs-note)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {portfolioLabel(p.name, p.slug)}
                      </div>
                      <div className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)', marginTop: 2 }}>
                        {p.walletCount} {p.walletCount === 1 ? 'wallet' : 'wallets'} · {p.chains.join(' + ') || '—'}
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' }}>
                      {fmtUsd0(p.totalUsd)}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ position: 'absolute', left: 1, right: 1, bottom: 0, height: 30, background: 'linear-gradient(to top, var(--surf), transparent)', pointerEvents: 'none' }} />
          </Card>
        </div>

        {/* CTA */}
        <div
          style={{
            marginTop: 44,
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-xl)',
            background: 'var(--surf)',
            padding: 'clamp(30px,5vw,48px) 24px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: '-40%', background: 'radial-gradient(ellipse at 50% 130%, var(--acc-soft), transparent 60%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'clamp(var(--fs-display),4vw,32px)', letterSpacing: '-0.03em' }}>
              All your wallets. One portfolio.
            </div>
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--mut)', marginTop: 10, lineHeight: 1.6 }}>
              Every chain, every DeFi position — tracked live and shareable by link.
            </div>
            <Button size="lg" onClick={primary} style={{ marginTop: 22 }}>
              {primaryLabel}
            </Button>
            <div style={{ marginTop: 12, fontSize: 'var(--fs-note)', color: 'var(--mut)' }}>Sign in with Telegram or X</div>
          </div>
        </div>
      </div>

      <div className="mono" style={{ textAlign: 'center', padding: '0 20px 28px', fontSize: 'var(--fs-micro)', color: 'var(--mut)' }}>
        © 2026 svinooh
      </div>

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
