import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HistoryDto, PortfolioDto, PublicPortfolioDto } from '@svinooh/shared';
import { AreaChart } from '../components/AreaChart';
import { AuthModal } from '../components/AuthModal';
import { ChainMarquee } from '../components/ChainMarquee';
import { Logo } from '../components/Logo';
import { SearchDropdown } from '../components/SearchDropdown';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtUsd, fmtUsd0, portfolioLabel } from '../lib/format';


export function Landing() {
  const { me } = useAuth();
  const navigate = useNavigate();

  const [authOpen, setAuthOpen] = useState(false);
  const [pubs, setPubs] = useState<PublicPortfolioDto[]>([]);
  const [demo, setDemo] = useState<PortfolioDto | null>(null);
  const [demoHistory, setDemoHistory] = useState<{ values: number[]; times: number[] } | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PublicPortfolioDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackErr, setTrackErr] = useState<string | null>(null);

  // The list below the fold is a fixed top-N and stays put while you type
  useEffect(() => {
    void api<PublicPortfolioDto[]>('/portfolios/public?limit=12').then(setPubs).catch(() => {});
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

  const topSlug = pubs[0]?.slug;
  useEffect(() => {
    if (!topSlug) return;
    void api<PortfolioDto>(`/portfolios/${topSlug}`).then(setDemo).catch(() => {});
    void api<HistoryDto>(`/portfolios/${topSlug}/history?range=30d`)
      .then((h) =>
        setDemoHistory({ values: h.points.map((p) => p.usd), times: h.points.map((p) => new Date(p.t).getTime()) }),
      )
      .catch(() => {});
  }, [topSlug]);

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
      navigate(`/p/${slug}`);
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

  const primary = () => (me ? navigate(`/p/${me.portfolioSlug}`) : setAuthOpen(true));
  const primaryLabel = me ? 'My portfolio' : 'Create portfolio';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div className="shell" style={{ height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo size={19} />
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          <button className="btn-acc" style={{ height: 32, fontSize: 12, padding: '0 14px' }} onClick={primary}>
            {primaryLabel}
          </button>
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
          <div style={{ fontWeight: 800, fontSize: 'clamp(30px,4.6vw,52px)', letterSpacing: '-0.04em', lineHeight: 1.08 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Every DeFi position.</span>
            <br />
            <span style={{ color: 'var(--acc-text)', whiteSpace: 'nowrap' }}>No exceptions.</span>
          </div>
          <div style={{ maxWidth: 430, marginTop: 18, fontSize: 15, lineHeight: 1.65, color: 'var(--mut)', textWrap: 'pretty' }}>
            Tokens, LP, staking, lending, farming — the DeFi positions other trackers miss, counted at full value.
          </div>
          <div style={{ marginTop: 26, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Typing opens a dropdown of matches right here, rather than
                quietly re-filtering a list further down the page. */}
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
              <input
                className="mono field hide-mobile"
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
                spellCheck={false}
                style={{ width: '100%', height: 46, padding: '0 18px', fontSize: 12.5 }}
              />
              {open && search.trim() ? (
                <SearchDropdown
                  results={results}
                  looksLikeAddress={looksLikeAddress}
                  tracking={tracking}
                  error={trackErr}
                  onPick={(slug) => {
                    setOpen(false);
                    navigate(`/p/${slug}`);
                  }}
                  onTrack={() => void trackAddress()}
                />
              ) : null}
            </div>
            <button
              className="btn-acc"
              style={{ height: 46, fontSize: 14, padding: '0 22px' }}
              onClick={primary}
            >
              {primaryLabel}
            </button>
          </div>
        </div>

        {/* demo card from the top public portfolio */}
        <div>
          <div className="card" style={{ overflow: 'hidden', boxShadow: '0 30px 80px -40px color-mix(in srgb, var(--acc) 35%, transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 0' }}>
              {/* The portfolio's own name, never its owner's */}
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--mut)' }}>
                {demo ? `${portfolioLabel(demo.name, demo.slug).toUpperCase()} · PUBLIC` : 'PUBLIC'}
              </span>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--acc-text)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--acc)', animation: 'svpulse 2.4s ease infinite' }} />
                LIVE
              </span>
            </div>
            <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 30, letterSpacing: '-0.02em' }}>
                {fmtUsd(demo?.totalUsd ?? pubs[0]?.totalUsd ?? 0)}
              </span>
            </div>
            <div style={{ padding: '4px 0 0' }}>
              <AreaChart values={demoHistory?.values ?? []} times={demoHistory?.times ?? []} period="30d" height="132px" variant="mini" />
            </div>
            {demoPositions.map((p) => (
              <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.symbol}
                  {p.name && p.name !== p.symbol ? ` · ${p.name}` : ''}
                </div>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--mut)' }}>
                  {p.category === 'staked' ? 'STAKING' : p.category === 'defi' ? 'DEFI' : 'TOKEN'}
                </span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                  {fmtUsd0(p.valueUsd)}
                </span>
              </div>
            ))}
            {demo ? (
              <div
                onClick={() => navigate(`/p/${demo.slug}`)}
                className="row-hover mono"
                style={{ borderTop: '1px solid var(--line)', padding: '11px 18px', textAlign: 'center', fontSize: 10, letterSpacing: '0.12em', color: 'var(--acc-text)', cursor: 'pointer', userSelect: 'none' }}
              >
                OPEN LIVE EXAMPLE →
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ChainMarquee />

      {/* public portfolios */}
      <div className="shell" style={{ width: '100%', padding: '36px clamp(14px,3.5vw,28px) 52px' }}>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div className="eyebrow">PUBLIC PORTFOLIOS</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--mut)' }}>
              {pubs.length} {pubs.length === 1 ? 'PORTFOLIO' : 'PORTFOLIOS'}
            </div>
          </div>
          {/* A plain list of what is public. Searching happens in the dropdown
              under the hero input, so this one never shifts under you. */}
          <div className="card" style={{ position: 'relative', marginTop: 14, overflow: 'hidden' }}>
            <div style={{ maxHeight: 328, overflowY: 'auto' }}>
              {pubs.length === 0 ? (
                <div className="mono" style={{ padding: '28px 16px', textAlign: 'center', fontSize: 11.5, color: 'var(--mut)' }}>
                  No public portfolios yet — be the first.
                </div>
              ) : (
                pubs.map((p, i) => (
                  <div
                    key={p.slug}
                    onClick={() => navigate(`/p/${p.slug}`)}
                    className="row-hover"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer' }}
                  >
                    <span className="mono" style={{ fontSize: 10, color: 'var(--mut)', width: 22, flexShrink: 0 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {/* The portfolio's own identity and its wallets — never who owns them. */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className={p.name ? undefined : 'mono'}
                        style={{ fontWeight: 700, fontSize: p.name ? 13.5 : 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {portfolioLabel(p.name, p.slug)}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--mut)', marginTop: 2 }}>
                        {p.walletCount} {p.walletCount === 1 ? 'wallet' : 'wallets'} · {p.chains.join(' + ') || '—'}
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                      {fmtUsd0(p.totalUsd)}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ position: 'absolute', left: 1, right: 1, bottom: 0, height: 30, background: 'linear-gradient(to top, var(--surf), transparent)', pointerEvents: 'none' }} />
          </div>
        </div>

        {/* CTA */}
        <div
          style={{
            marginTop: 44,
            border: '1px solid var(--line)',
            borderRadius: 20,
            background: 'var(--surf)',
            padding: 'clamp(30px,5vw,48px) 24px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: '-40%', background: 'radial-gradient(ellipse at 50% 130%, var(--acc-soft), transparent 60%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontWeight: 800, fontSize: 'clamp(22px,4vw,32px)', letterSpacing: '-0.03em' }}>
              All your wallets. One portfolio.
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--mut)', marginTop: 10, lineHeight: 1.6 }}>
              Every chain, every DeFi position — tracked live and shareable by link.
            </div>
            <button
              className="btn-acc"
              style={{ height: 46, fontSize: 14, padding: '0 26px', marginTop: 22 }}
              onClick={primary}
            >
              {primaryLabel}
            </button>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mut)' }}>Sign in with Telegram or X</div>
          </div>
        </div>
      </div>

      <div className="mono" style={{ textAlign: 'center', padding: '0 20px 28px', fontSize: 10, color: 'var(--mut)' }}>
        © 2026 svinooh
      </div>

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
