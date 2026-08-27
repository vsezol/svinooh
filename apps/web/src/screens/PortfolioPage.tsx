'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HistoryDto, HistoryRange, PortfolioDto } from '@svinooh/shared';
import { AnimatedUsd } from '../components/AnimatedUsd';
import { AreaChart } from '../components/AreaChart';
import { AuthModal } from '../components/AuthModal';
import { ClaimModal } from '../components/ClaimModal';
import { Logo } from '../components/Logo';
import { MetricCards } from '../components/MetricCards';
import { GoPublicModal, VisibilityCard } from '../components/PortfolioVisibility';
import { ScopeSelect } from '../components/ScopeSelect';
import { ShareButton } from '../components/ShareButton';
import { SyncedAgo } from '../components/SyncedAgo';
import { ThemeToggle } from '../components/ThemeToggle';
import { WalletRow, type WalletActions } from '../components/WalletRow';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pendingClaim } from '../lib/claim';
import {
  blockMatches,
  buildBlocks,
  debtTotals,
  filteredTotal,
  rewardsTotals,
  type PositionFilter,
} from '../lib/blocks';
import { fmtUsd, portfolioLabel, walletName } from '../lib/format';
import { PERIODS, WINDOW_MS } from '../lib/ranges';

const FILTERS: Array<{ key: PositionFilter; label: string }> = [
  { key: 'all', label: 'ALL' },
  { key: 'pools', label: 'POOLS' },
  { key: 'lending', label: 'LENDING' },
];


/**
 * `viewerId` is not used in the request — it's a reload trigger. The bot's
 * button lands straight on /p/<slug>, so the page first loads as a guest and
 * signs in a moment later; without refetching, `isOwner` would stay false and
 * the owner's controls wouldn't appear until a manual refresh.
 */
function usePortfolio(slug: string, viewerId: string | null) {
  const [data, setData] = useState<PortfolioDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api<PortfolioDto>(`/portfolios/${slug}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'Something went wrong'));
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload, viewerId]);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [slug]);

  useEffect(() => {
    const hasPending = data?.wallets.some((w) => w.status === 'pending') ?? false;
    const id = window.setInterval(
      () => {
        if (!document.hidden) void reload();
      },
      hasPending ? 3000 : 60_000,
    );
    return () => window.clearInterval(id);
  }, [data, reload]);

  return { data, error, reload };
}

/** History for the selected scope (whole portfolio / a specific wallet) and period */
function useHistory(slug: string, scope: string, period: HistoryRange, refreshKey: string | null) {
  const [points, setPoints] = useState<{ values: number[]; times: number[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const path =
          scope === 'all'
            ? `/portfolios/${slug}/history?range=${period}`
            : `/portfolios/${slug}/wallets/${scope}/history?range=${period}`;
        const h = await api<HistoryDto>(path);
        if (cancelled) return;
        setPoints({
          values: h.points.map((p) => p.usd),
          times: h.points.map((p) => new Date(p.t).getTime()),
        });
      } catch {
        if (!cancelled) setPoints({ values: [], times: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, scope, period, refreshKey]);

  return points;
}

export function PortfolioPage({ slug }: { slug: string }) {
  const router = useRouter();
  const { me, logout } = useAuth();
  const { data, error, reload } = usePortfolio(slug, me?.id ?? null);

  const [scope, setScope] = useState<string>('all');
  const [period, setPeriod] = useState<HistoryRange>('24h');
  const [filter, setFilter] = useState<PositionFilter>('all');
  const [authOpen, setAuthOpen] = useState(false);
  const [input, setInput] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [confirmClaim, setConfirmClaim] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const history = useHistory(slug, scope, period, data?.updatedAt ?? null);

  // the selected wallet was deleted — fall back to "all wallets"
  useEffect(() => {
    if (scope !== 'all' && data && !data.wallets.some((w) => w.id === scope)) setScope('all');
  }, [data, scope]);

  const wallets = data?.wallets ?? [];
  const rewards = useMemo(() => rewardsTotals(wallets), [wallets]);
  const debt = useMemo(() => debtTotals(wallets), [wallets]);
  const blocksByWallet = useMemo(() => wallets.map((w) => buildBlocks(w.positions)), [wallets]);
  const shownTotal = useMemo(() => filteredTotal(blocksByWallet, filter), [blocksByWallet, filter]);

  // The series reaches back several windows so the chart has somewhere to
  // scroll to, but this line answers the button: it starts at the first reading
  // inside the chosen window, not at the oldest one that came with it. Scrolling
  // the chart does not move it — "+0.42% · 24H" means the last 24 hours wherever
  // you have wandered off to.
  const change = useMemo(() => {
    if (!history || history.values.length < 2) return null;
    const { values, times } = history;
    const window = WINDOW_MS[period];
    const opens = window === null ? -Infinity : times[times.length - 1] - window;
    const at = times.findIndex((t) => t >= opens);
    const first = values[at < 0 || at > values.length - 2 ? 0 : at];
    const last = values[values.length - 1];
    const chg = last - first;
    const pct = first ? (chg / first) * 100 : 0;
    return { chg, pct, up: chg >= 0 };
  }, [history, period]);

  const addWallet = async () => {
    const address = input.trim();
    if (!address || adding) return;
    setAdding(true);
    setAddErr(null);
    try {
      await api(`/portfolios/${slug}/wallets`, { method: 'POST', body: JSON.stringify({ address }) });
      setInput('');
      await reload();
    } catch (err) {
      setAddErr(err instanceof ApiError ? err.message : 'Could not add wallet');
    } finally {
      setAdding(false);
    }
  };

  const removeWallet = async (walletId: string) => {
    try {
      await api(`/portfolios/${slug}/wallets/${walletId}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not remove');
    }
  };

  const renameWallet = async (walletId: string, label: string) => {
    try {
      await api(`/portfolios/${slug}/wallets/${walletId}`, { method: 'PATCH', body: JSON.stringify({ label }) });
      await reload();
    } catch {
      // didn't save — the previous name comes back on the next reload
    }
  };

  /**
   * Reaching for an owner-only action on a portfolio nobody owns. Signed in, we
   * ask whether they want to take it over; signed out, the intent is parked and
   * the sign-in that follows completes it (see settleClaim).
   */
  const startClaim = () => {
    if (me) {
      setConfirmClaim(true);
      return;
    }
    pendingClaim.set(slug);
    setAuthOpen(true);
  };

  const claim = async () => {
    setClaiming(true);
    try {
      await api(`/portfolios/${slug}/claim`, { method: 'POST' });
      setConfirmClaim(false);
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not take this portfolio over');
    } finally {
      setClaiming(false);
    }
  };

  const setVisibility = async (isPublic: boolean) => {
    setSavingVisibility(true);
    setConfirmPublic(false);
    try {
      await api(`/portfolios/${slug}/visibility`, { method: 'PATCH', body: JSON.stringify({ isPublic }) });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not change visibility');
    } finally {
      setSavingVisibility(false);
    }
  };

  if (error) {
    return (
      <div className="shell" style={{ padding: '90px 0', textAlign: 'center', color: 'var(--mut)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <Logo size={24} onClick={() => router.push('/')} />
        </div>
        {error.statusCode === 404 ? 'No portfolio at this link' : error.message}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '120px 0', textAlign: 'center' }}>
        <span className="spin" style={{ width: 22, height: 22 }} />
      </div>
    );
  }

  const isOwner = data.isOwner;
  // A portfolio nobody owns is open for building: anyone can add wallets to it
  // without an account. Taking wallets out, or renaming them, still needs one.
  const isUnowned = data.visibility === 'anonymous';
  const canAdd = isOwner || isUnowned;
  const walletActions: WalletActions = isOwner ? 'edit' : isUnowned ? 'locked' : 'none';
  const walletCount = wallets.filter((w) => w.status !== 'pending').length;
  const selectedWallet = scope === 'all' ? null : wallets.find((w) => w.id === scope);
  const headlineTotal = selectedWallet ? (selectedWallet.totalUsd ?? 0) : data.totalUsd;
  // An empty chart frame that explains history arrives later is the biggest
  // thing on a fresh portfolio and says nothing — it appears once there is a
  // line to draw.
  const hasChart = wallets.some((w) => w.totalUsd !== null) && (history?.values.length ?? 0) >= 2;

  const scopeOptions = [
    { id: 'all', label: 'All wallets', valueUsd: data.totalUsd },
    ...wallets
      .filter((w) => w.status !== 'pending')
      .map((w) => ({ id: w.id, label: walletName(w.label, w.chain), valueUsd: w.totalUsd })),
  ];

  const visNote =
    data.visibility === 'public'
      ? 'VISIBLE TO EVERYONE'
      : data.visibility === 'private'
        ? 'ONLY PEOPLE WITH THE LINK'
        : 'SHARED PORTFOLIO';

  // Same predicate the rows and the running total use — a second copy of it
  // here is how the list came to disagree with the number above it
  const visibleWallets = wallets.filter(
    (w, i) => filter === 'all' || w.status === 'pending' || blocksByWallet[i].some((b) => blockMatches(b, filter)),
  );

  return (
    <div>
      {/* a guest never learns whose portfolio this is */}
      {!isOwner ? (
        <div
          style={{
            background: 'var(--surf2)',
            borderBottom: '1px solid var(--line)',
            padding: '9px clamp(14px,3.5vw,28px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div className="mono" style={{ fontSize: 11, fontWeight: 500, color: 'var(--mut)', letterSpacing: '0.03em' }}>
            {isUnowned
              ? 'This portfolio belongs to nobody · add wallets freely'
              : 'Viewing a shared portfolio · read-only'}
          </div>
          <div
            onClick={isUnowned ? startClaim : () => setAuthOpen(true)}
            className="mono"
            style={{
              fontSize: 10.5,
              letterSpacing: '0.06em',
              color: 'var(--acc-text)',
              border: '1px solid color-mix(in srgb, var(--acc) 45%, transparent)',
              borderRadius: 999,
              padding: '5px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isUnowned ? 'MAKE IT MINE →' : 'CREATE YOUR PORTFOLIO →'}
          </div>
        </div>
      ) : null}

      {/* header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div className="shell" style={{ height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Logo size={21} onClick={() => router.push('/')} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThemeToggle />
            {isOwner && me ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                {me.photoUrl ? (
                  <img src={me.photoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%' }} />
                ) : (
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: 'var(--acc-soft)',
                      border: '1px solid color-mix(in srgb, var(--acc) 40%, transparent)',
                      color: 'var(--acc-text)',
                      fontSize: 11,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {(me.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                {/* the viewer's own handle, shown only to them */}
                <span className="mono hide-mobile" style={{ fontSize: 11.5, color: 'var(--mut)' }}>
                  {me.username ? `@${me.username}` : me.name}
                </span>
                <button
                  className="pill"
                  style={{ border: 'none', padding: '0 6px' }}
                  onClick={() => {
                    logout();
                    router.push('/');
                  }}
                >
                  EXIT
                </button>
              </div>
            ) : (
              <button className="btn-acc" style={{ height: 34, fontSize: 12, padding: '0 14px' }} onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="shell" style={{ padding: 'clamp(20px,4vw,36px) clamp(14px,3.5vw,28px) 60px' }}>
        {/* total */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div className="eyebrow">
                {selectedWallet ? 'WALLET BALANCE' : 'TOTAL BALANCE'} · {walletCount}{' '}
                {walletCount === 1 ? 'WALLET' : 'WALLETS'}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                <AnimatedUsd
                  className="mono"
                  value={headlineTotal}
                  style={{ fontWeight: 600, fontSize: 'clamp(30px,6vw,44px)', letterSpacing: '-0.02em', lineHeight: 1 }}
                />
                {change ? (
                  <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: change.up ? 'var(--up)' : 'var(--down)' }}>
                    {(change.up ? '+' : '−') +
                      fmtUsd(Math.abs(change.chg), 0) +
                      ' (' +
                      (change.up ? '+' : '') +
                      change.pct.toFixed(2) +
                      '%) · ' +
                      period.toUpperCase()}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {isOwner ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <VisibilityCard
                visibility={data.visibility}
                busy={savingVisibility}
                onGoPublic={() => setConfirmPublic(true)}
                onGoPrivate={() => void setVisibility(false)}
              />
              <ShareButton title={`${portfolioLabel(data.name, data.slug)} · svinooh`} />
            </div>
          ) : (
            <ShareButton title={`${portfolioLabel(data.name, data.slug)} · svinooh`} />
          )}
        </div>

        <div
          className="mono"
          style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 10.5, color: 'var(--mut)', letterSpacing: '0.04em' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--acc)', animation: 'svpulse 2.4s ease infinite' }} />
            <SyncedAgo iso={data.updatedAt} />
          </span>
          {isOwner ? <span>{visNote}</span> : null}
        </div>

        {/* scope + period, on one row: the period tabs stay pinned right on a phone */}
        {hasChart ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'nowrap', marginTop: 22 }}>
              <ScopeSelect options={scopeOptions} value={scope} onChange={setScope} />
              <div style={{ display: 'flex', gap: 2, border: '1px solid var(--line)', borderRadius: 999, padding: 2, flexShrink: 0 }}>
                {PERIODS.map((p) => (
                  <button key={p.key} className={`period ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <AreaChart values={history?.values ?? []} times={history?.times ?? []} period={period} height="clamp(160px,26vw,240px)" />
            </div>
          </>
        ) : null}

        <MetricCards rewards={rewards} debt={debt} />

        {/* add wallet */}
        {canAdd ? (
          <div style={{ marginTop: 26 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="mono add-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setAddErr(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addWallet();
                }}
                placeholder="Enter wallet address"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="btn-acc" style={{ height: 44, fontSize: 13, padding: '0 20px' }} onClick={() => void addWallet()} disabled={adding}>
                {adding ? <span className="spin" style={{ width: 15, height: 15, borderTopColor: 'var(--acc-ink)' }} /> : 'Add wallet'}
              </button>
            </div>
            {addErr ? (
              <div className="mono" style={{ marginTop: 7, fontSize: 11, color: 'var(--down)' }}>
                {addErr}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* which positions to show, and what they add up to */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 26, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, fontWeight: 500, color: 'var(--mut)' }}>
            {filter === 'all' ? `${walletCount} ${walletCount === 1 ? 'wallet' : 'wallets'}` : 'Shown'} · {fmtUsd(shownTotal)}
          </div>
        </div>

        {visibleWallets.length === 0 ? (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
            {wallets.length === 0
              ? canAdd
                ? 'No wallets yet. Paste an address above — the network is detected automatically.'
                : 'This portfolio has no wallets yet.'
              : 'Nothing matches this filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visibleWallets.map((w) => (
              <WalletRow
                key={w.id}
                wallet={w}
                actions={walletActions}
                total={data.totalUsd}
                filter={filter}
                onRemove={() => void removeWallet(w.id)}
                onRename={(label) => void renameWallet(w.id, label)}
                onRequireAuth={startClaim}
              />
            ))}
          </div>
        )}
      </div>

      {confirmClaim ? (
        <ClaimModal busy={claiming} onCancel={() => setConfirmClaim(false)} onConfirm={() => void claim()} />
      ) : null}
      {confirmPublic ? (
        <GoPublicModal onCancel={() => setConfirmPublic(false)} onConfirm={() => void setVisibility(true)} />
      ) : null}
      {authOpen ? (
        <AuthModal
          onClose={() => {
            setAuthOpen(false);
            pendingClaim.clear();
          }}
        />
      ) : null}
    </div>
  );
}
