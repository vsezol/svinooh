'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { HistoryRange, PortfolioDto } from '@svinooh/shared';
import { Button, Card, Eyebrow, Input, Segmented, Spinner, TagButton } from '../ui';
import { AnimatedUsd } from '../components/AnimatedUsd';
import { AlertSettings } from '../components/AlertSettings';
import { AreaChart } from '../components/AreaChart';
import { AuthModal } from '../components/AuthModal';
import { ClaimModal } from '../components/ClaimModal';
import { Logo } from '../components/Logo';
import { MetricCards } from '../components/MetricCards';
import { GoPublicModal, VisibilityCard } from '../components/PortfolioVisibility';
import { ScopeSelect } from '../components/ScopeSelect';
import { ShareButton } from '../components/ShareButton';
import { MobileTabs, tabsFor, tabIndex, usePager } from '../components/MobileTabs';
import { AgentChat } from '../components/agent/AgentChat';
import { SideNav, type Tab } from '../components/SideNav';
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
import {
  cachedHistory,
  EMPTY_HISTORY,
  loadHistory,
  prefetchHistory,
  type History,
} from '../lib/history';
import { AGENT_ENABLED } from '../lib/agent';
import { localAnswerer } from '../lib/agent-local';
import { PERIODS, WINDOW_MS } from '../lib/ranges';

/**
 * The admin panel, fetched only when an admin opens its tab.
 *
 * `ssr: false` and a dynamic import keep it out of the bundle everybody else
 * downloads — it is a separate chunk that is never requested unless the tab is
 * rendered. That is about weight, not secrecy: the chunk is fetchable by anyone
 * who learns its URL, and what protects the system is that every route behind
 * it checks the database and answers NotFound to a non-admin.
 */
const AdminPanel = dynamic(() => import('../components/admin/AdminPanel'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: '40px 0', textAlign: 'center' }}>
      <Spinner size={20} />
    </div>
  ),
});

/** What the window moved by, in money and in percent: "+$432 (+0.51%)" */
interface Change {
  chg: number;
  pct: number;
  up: boolean;
}

const changeLabel = (change: Change): string =>
  (change.up ? '+' : '−') +
  fmtUsd(Math.abs(change.chg), 0) +
  ' (' +
  (change.up ? '+' : '') +
  change.pct.toFixed(2) +
  '%)';

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

/**
 * History for the selected scope (whole portfolio / a specific wallet) and
 * period — three lines off the same readings, so they share a time axis and one
 * request.
 *
 * What comes back is the data **and the period it is the data for**, together.
 * That pairing is the point: a period is a window width, so a chart handed the
 * new width and the old readings redraws the previous period's points squeezed
 * into the new window — visibly coarser or finer than the truth — and then
 * redraws again a moment later when the real answer lands. Two jumps to change
 * one thing. Keeping them together means the chart changes once, when there is
 * something to change to, and the period buttons stay instant because they
 * follow the press rather than the request.
 *
 * A period already in the cache is applied in the same commit as the press, so
 * the usual case has no request in it at all — see prefetchHistory. Cached but
 * a sync behind still goes up straight away and is replaced behind itself: the
 * period does not change, so nothing jumps, and a chart three minutes short at
 * the right-hand edge is not the thing worth making somebody wait for.
 */
function useHistory(slug: string, scope: string, period: HistoryRange, refreshKey: string | null) {
  const [shown, setShown] = useState<{ period: HistoryRange; data: History } | null>(null);

  useEffect(() => {
    // Nothing until the portfolio has landed. The chart cannot render before it
    // does — the page is still a spinner — so a request now is one answer
    // fetched twice: once against no sync at all, and again the moment there is
    // one to key it to.
    if (refreshKey === null) return;
    let cancelled = false;
    const ready = cachedHistory(slug, scope, period);
    if (ready) setShown({ period, data: ready });
    void loadHistory(slug, scope, period, refreshKey)
      .then((data) => {
        if (!cancelled) setShown({ period, data });
      })
      .catch(() => {
        if (!cancelled) setShown({ period, data: EMPTY_HISTORY });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, scope, period, refreshKey]);

  return shown;
}

export function PortfolioPage({ slug }: { slug: string }) {
  const router = useRouter();
  const { me, config, logout } = useAuth();
  const { data, error, reload } = usePortfolio(slug, me?.id ?? null);

  const [tab, setTab] = useState<Tab>('portfolio');
  // Collapsed is the rail's own business and nobody else's — it survives a tab
  // change and nothing else needs to know
  const [sideCollapsed, setSideCollapsed] = useState(false);
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
  // The period the chart is currently drawn at, which is the period of the data
  // it has — not necessarily the button that was last pressed
  const drawn = history?.period ?? period;

  // The other four periods, warmed one at a time whenever the page has nothing
  // else in the air, so pressing a period button is a redraw and not a wait.
  // Only for the scope on screen: five periods across seven wallets is
  // thirty-five requests to save a click somebody may never make.
  useEffect(() => {
    const stamp = data?.updatedAt ?? null;
    if (!stamp) return;
    let cancelled = false;
    void prefetchHistory(
      slug,
      scope,
      PERIODS.map((p) => p.key),
      stamp,
      () => cancelled,
    );
    return () => {
      cancelled = true;
    };
  }, [slug, scope, data?.updatedAt]);

  // the selected wallet was deleted — fall back to "all wallets"
  useEffect(() => {
    if (scope !== 'all' && data && !data.wallets.some((w) => w.id === scope)) setScope('all');
  }, [data, scope]);

  const wallets = data?.wallets ?? [];
  /**
   * What the two metric cards are about. The scope selector already re-points
   * the headline figure and all three charts at one wallet; these read it the
   * same way, so a card cannot end up reporting the portfolio's claimable over
   * a line drawn from one wallet's — the figure and the line under it saying
   * different things about the same card.
   */
  const scoped = useMemo(
    () => (scope === 'all' ? wallets : wallets.filter((w) => w.id === scope)),
    [wallets, scope],
  );
  const rewards = useMemo(() => rewardsTotals(scoped), [scoped]);
  const debt = useMemo(() => debtTotals(scoped), [scoped]);
  const blocksByWallet = useMemo(() => wallets.map((w) => buildBlocks(w.positions)), [wallets]);
  const shownTotal = useMemo(() => filteredTotal(blocksByWallet, filter), [blocksByWallet, filter]);

  // The series reaches back several windows so the chart has somewhere to
  // scroll to, but this line answers the button: it starts at the first reading
  // inside the chosen window, not at the oldest one that came with it. Scrolling
  // the chart does not move it — "+0.42% · 24H" means the last 24 hours wherever
  // you have wandered off to.
  const change = useMemo(() => {
    if (!history || history.data.total.values.length < 2) return null;
    const { values, times } = history.data.total;
    const window = WINDOW_MS[history.period];
    const opens = window === null ? -Infinity : times[times.length - 1] - window;
    const at = times.findIndex((t) => t >= opens);
    const first = values[at < 0 || at > values.length - 2 ? 0 : at];
    const last = values[values.length - 1];
    const chg = last - first;
    const pct = first ? (chg / first) * 100 : 0;
    return { chg, pct, up: chg >= 0 };
  }, [history]);

  // Above the loading states, where the hooks all have to be: the strip only
  // needs which tab is open, which is state rather than anything fetched
  // `me` is not loaded yet on the first render, so the strip starts without the
  // admin page and gains it a moment later — which is the same thing that
  // happens to the whole owner view, and for the same reason
  const isAdmin = me?.isAdmin === true;
  const tabs = tabsFor(isAdmin);
  const pager = usePager(tabIndex(tab, isAdmin), (index) => setTab(tabs[index].key), tabs.length);

  /**
   * What the agent is allowed to look at: the portfolio already on screen.
   *
   * Nothing is fetched for it and nothing is sent anywhere — the answering is a
   * local stand-in until the service exists, and it reads the same numbers the
   * page is drawing. Rebuilt when the data or the window changes, so an answer
   * quotes what the reader can see rather than what was true when the tab
   * opened.
   */
  const answer = useMemo(
    () =>
      localAnswerer({
        wallets: data?.wallets ?? [],
        totalUsd: data?.totalUsd ?? 0,
        history: history?.data.total ?? EMPTY_HISTORY.total,
        period: history?.period ?? period,
        change: change ? { label: changeLabel(change), up: change.up } : null,
      }),
    [data, history, period, change],
  );

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
        <Spinner size={22} />
      </div>
    );
  }

  const isOwner = data.isOwner;
  // A visitor has no rail, so they can only ever be on the one tab the link
  // pointed them at — whatever state says
  const activeTab: Tab = isOwner ? tab : 'portfolio';
  const syncMinutes = config?.syncIntervalMin ?? 5;
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
  const hasChart = wallets.some((w) => w.totalUsd !== null) && (history?.data.total.values.length ?? 0) >= 2;

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
          <div className="mono" style={{ fontSize: 'var(--fs-tag)', fontWeight: 'var(--fw-normal)', color: 'var(--mut)', letterSpacing: '0.03em' }}>
            {isUnowned
              ? 'This portfolio belongs to nobody · add wallets freely'
              : 'Viewing a shared portfolio · read-only'}
          </div>
          <div
            onClick={isUnowned ? startClaim : () => setAuthOpen(true)}
            className="mono"
            style={{
              fontSize: 'var(--fs-tag)',
              letterSpacing: '0.06em',
              color: 'var(--acc-text)',
              border: '1px solid color-mix(in srgb, var(--acc) 45%, transparent)',
              borderRadius: 'var(--r-full)',
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
        className="app-header"
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
                      fontSize: 'var(--fs-tag)',
                      fontWeight: 'var(--fw-heavy)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {(me.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                {/* the viewer's own handle, shown only to them */}
                <span className="mono hide-mobile" style={{ fontSize: 'var(--fs-note)', color: 'var(--mut)' }}>
                  {me.username ? `@${me.username}` : me.name}
                </span>
                <TagButton
                  variant="bare"
                  onClick={() => {
                    logout();
                    router.push('/');
                  }}
                >
                  EXIT
                </TagButton>
              </div>
            ) : (
              <Button size="sm" onClick={() => setAuthOpen(true)}>
                Sign in
              </Button>
            )}
          </div>
        </div>
      </div>

      {isOwner ? <MobileTabs tab={tab} onTab={setTab} isAdmin={isAdmin} /> : null}

      <div
        className="shell"
        style={{
          paddingTop: 'clamp(20px,4vw,36px)',
          paddingBottom: 60,
          display: 'flex',
          gap: 'clamp(18px,3vw,30px)',
          alignItems: 'flex-start',
        }}
      >
        {isOwner ? (
          <SideNav
            tab={tab}
            onTab={setTab}
            collapsed={sideCollapsed}
            onCollapse={setSideCollapsed}
            isAdmin={isAdmin}
          />
        ) : null}

        {/* On a phone both pages ride one strip the finger drags between them;
            above the breakpoint the strip flattens and only the open one is
            rendered — see .pager */}
        <div className="pager-window" style={{ flex: 1, minWidth: 0 }} {...pager.handlers}>
          <div className="pager" style={pager.style} data-moving={pager.moving}>
            <div className="pane" data-active={activeTab === 'portfolio'}>
            {/* total */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div>
                  <Eyebrow>
                    {selectedWallet ? 'WALLET BALANCE' : 'TOTAL BALANCE'} · {walletCount}{' '}
                    {walletCount === 1 ? 'WALLET' : 'WALLETS'}
                  </Eyebrow>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                    <AnimatedUsd
                      className="mono"
                      value={headlineTotal}
                      style={{ fontWeight: 'var(--fw-medium)', fontSize: 'clamp(var(--fs-hero),6vw,44px)', letterSpacing: '-0.02em', lineHeight: 1 }}
                    />
                    {change ? (
                      <div className="mono" style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)', color: change.up ? 'var(--up)' : 'var(--down)' }}>
                        {`${changeLabel(change)} · ${drawn.toUpperCase()}`}
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
              style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 'var(--fs-tag)', color: 'var(--mut)', letterSpacing: '0.04em' }}
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
                  <div
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-full)',
                      padding: 'var(--sp-1)',
                      flexShrink: 0,
                    }}
                  >
                    <Segmented
                      label="Chart period"
                      items={PERIODS}
                      value={period}
                      onChange={setPeriod}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <AreaChart
                    values={history?.data.total.values ?? []}
                    times={history?.data.total.times ?? []}
                    period={drawn}
                    height="clamp(160px,26vw,240px)"
                  />
                </div>
              </>
            ) : null}

            <MetricCards
              rewards={rewards}
              debt={debt}
              claimableSeries={history?.data.claimable ?? EMPTY_HISTORY.claimable}
              debtSeries={history?.data.debt ?? EMPTY_HISTORY.debt}
              period={drawn}
            />

            {/* add wallet */}
            {canAdd ? (
              <div style={{ marginTop: 26 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Input
                    mono
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setAddErr(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addWallet();
                    }}
                    placeholder="Enter wallet address"
                    aria-label="Wallet address"
                    spellCheck={false}
                    autoComplete="off"
                    style={{ flex: 1, minWidth: 220, width: 'auto' }}
                  />
                  <Button size="lg" loading={adding} onClick={() => void addWallet()}>
                    Add wallet
                  </Button>
                </div>
                {addErr ? (
                  <div className="mono" style={{ marginTop: 7, fontSize: 'var(--fs-tag)', color: 'var(--down)' }}>
                    {addErr}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* which positions to show, and what they add up to */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 26, marginBottom: 12 }}>
              <Segmented label="Which positions to show" items={FILTERS} value={filter} onChange={setFilter} tone="accent" />
              <div className="mono" style={{ fontSize: 'var(--fs-tag)', fontWeight: 'var(--fw-normal)', color: 'var(--mut)' }}>
                {filter === 'all' ? `${walletCount} ${walletCount === 1 ? 'wallet' : 'wallets'}` : 'Shown'} · {fmtUsd(shownTotal)}
              </div>
            </div>

            {visibleWallets.length === 0 ? (
              <Card style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 'var(--fs-body)' }}>
                {wallets.length === 0
                  ? canAdd
                    ? 'No wallets yet. Paste an address above — the network is detected automatically.'
                    : 'This portfolio has no wallets yet.'
                  : 'Nothing matches this filter.'}
              </Card>
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

            {isOwner ? (
              <div className="pane" data-active={activeTab === 'notifications'}>
                <AlertSettings slug={slug} wallets={wallets} syncMinutes={syncMinutes} />
              </div>
            ) : null}

            {/* One pane per entry in tabsFor() — a page in the strip that the
                strip does not list is a page nothing can reach and one more
                thing to keep in step. See AGENT_ENABLED and isAdmin. */}
            {isOwner && AGENT_ENABLED ? (
              <div className="pane" data-active={activeTab === 'agent'}>
                <AgentChat answer={answer} />
              </div>
            ) : null}

            {isOwner && isAdmin ? (
              <div className="pane" data-active={activeTab === 'admin'}>
                {activeTab === 'admin' ? <AdminPanel /> : null}
              </div>
            ) : null}
          </div>
        </div>
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
