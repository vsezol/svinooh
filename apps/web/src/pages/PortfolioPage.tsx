import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HistoryDto, HistoryRange, PortfolioDto } from '@svinooh/shared';
import { AreaChart } from '../components/AreaChart';
import { AuthModal } from '../components/AuthModal';
import { Logo } from '../components/Logo';
import { WalletRow } from '../components/WalletRow';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { GoPublicModal, VisibilityCard } from '../components/PortfolioVisibility';
import { RewardsStrip } from '../components/RewardsStrip';
import { rewardsTotals } from '../lib/blocks';
import { fmtUsd, walletName } from '../lib/format';
import { useTheme } from '../lib/theme';

const PERIODS: Array<{ key: HistoryRange; label: string }> = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'ALL' },
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

export function PortfolioPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { data, error, reload } = usePortfolio(slug, me?.id ?? null);

  const [scope, setScope] = useState<string>('all');
  const [period, setPeriod] = useState<HistoryRange>('24h');
  const [authOpen, setAuthOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  const history = useHistory(slug, scope, period, data?.updatedAt ?? null);

  // the selected wallet was deleted — fall back to "all wallets"
  useEffect(() => {
    if (scope !== 'all' && data && !data.wallets.some((w) => w.id === scope)) setScope('all');
  }, [data, scope]);

  const rewards = useMemo(() => rewardsTotals(data?.wallets ?? []), [data]);

  const change = useMemo(() => {
    if (!history || history.values.length < 2) return null;
    const first = history.values[0];
    const last = history.values[history.values.length - 1];
    const chg = last - first;
    const pct = first ? (chg / first) * 100 : 0;
    return { chg, pct, up: chg >= 0 };
  }, [history]);

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

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

  const renameWallet = async (walletId: string, label: string) => {
    try {
      await api(`/portfolios/${slug}/wallets/${walletId}`, { method: 'PATCH', body: JSON.stringify({ label }) });
      await reload();
    } catch {
      // didn't save — the previous name comes back on the next reload
    }
  };

  if (error) {
    return (
      <div className="shell" style={{ padding: '90px 0', textAlign: 'center', color: 'var(--mut)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <Logo size={24} onClick={() => navigate('/')} />
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
  const walletCount = data.wallets.filter((w) => w.status !== 'pending').length;
  const selectedWallet = scope === 'all' ? null : data.wallets.find((w) => w.id === scope);
  const headlineTotal = selectedWallet ? (selectedWallet.totalUsd ?? 0) : data.totalUsd;
  // An empty chart frame with "history shows up later" in it is worse than no
  // chart: on a fresh portfolio it is the biggest thing on the page and says
  // nothing. It appears once a wallet has synced AND there are points to plot.
  const hasChart = data.wallets.some((w) => w.totalUsd !== null) && (history?.values.length ?? 0) >= 2;

  const changeHelp =
    scope === 'all'
      ? `Change over ${period.toUpperCase()}. For each wallet: its value now minus its value at the start of the period; summed across wallets, then divided by the combined value at the start. Adding a wallet doesn't count as profit.`
      : `Change over ${period.toUpperCase()}: this wallet's value now minus its value at the start of the period.`;

  const scopeChips = [
    { id: 'all', label: 'ALL WALLETS' },
    ...data.wallets
      .filter((w) => w.status !== 'pending')
      .map((w) => ({ id: w.id, label: walletName(w.label, w.chain).toUpperCase() })),
  ];

  return (
    <div>
      {/* public banner */}
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
          {/* Never name the owner here: a balance next to a handle is exactly
              the deanonymization we refuse to ship. */}
          <div className="mono" style={{ fontSize: 11, color: 'var(--mut)', letterSpacing: '0.03em' }}>
            Viewing a shared portfolio · read-only
          </div>
          <div
            onClick={() => setAuthOpen(true)}
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
            CREATE YOUR PORTFOLIO →
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
        <div
          className="shell"
          style={{ height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
        >
          <Logo size={21} onClick={() => navigate('/')} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="pill" onClick={copyLink}>
              {copied ? 'COPIED ✓' : 'COPY LINK'}
            </button>
            <button className="pill" onClick={toggle}>
              {theme === 'dark' ? 'LIGHT' : 'DARK'}
            </button>
            {isOwner && me ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                {me.photoUrl ? (
                  <img src={me.photoUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                ) : (
                  <div
                    style={{
                      width: 28,
                      height: 28,
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
                <span className="mono hide-mobile" style={{ fontSize: 11.5, color: 'var(--mut)' }}>
                  {me.username ? `@${me.username}` : me.name}
                </span>
                <button
                  className="pill"
                  style={{ border: 'none', padding: '0 6px' }}
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  EXIT
                </button>
              </div>
            ) : (
              <button className="btn-acc" style={{ height: 32, fontSize: 12, padding: '0 14px' }} onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="shell" style={{ padding: 'clamp(20px,4vw,36px) clamp(14px,3.5vw,28px) 60px' }}>
        {/* total */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">
              {selectedWallet ? 'WALLET BALANCE' : 'TOTAL BALANCE'} · {walletCount}{' '}
              {walletCount === 1 ? 'WALLET' : 'WALLETS'}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
              <div className="mono" style={{ fontWeight: 600, fontSize: 'clamp(30px,6vw,44px)', letterSpacing: '-0.02em', lineHeight: 1 }}>
                {fmtUsd(headlineTotal)}
              </div>
              {change ? (
                <div
                  className="mono"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: change.up ? 'var(--up)' : 'var(--down)' }}
                >
                  <span>
                    {(change.up ? '+$' : '−$') +
                      Math.abs(change.chg).toLocaleString('en-US', { maximumFractionDigits: 0 }) +
                      ' (' +
                      (change.up ? '+' : '') +
                      change.pct.toFixed(2) +
                      '%) · ' +
                      period.toUpperCase()}
                  </span>
                  <span className="infotip" tabIndex={0} role="note" aria-label="How the change is calculated">
                    i<span className="infotip-pop">{changeHelp}</span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {isOwner ? (
            <VisibilityCard
              visibility={data.visibility}
              busy={savingVisibility}
              onGoPublic={() => setConfirmPublic(true)}
              onGoPrivate={() => void setVisibility(false)}
            />
          ) : null}
        </div>

        {/* chips + periods + chart — only once there is a line to draw */}
        {hasChart ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {scopeChips.map((c) => (
                  <button key={c.id} className={`chip ${scope === c.id ? 'active' : ''}`} onClick={() => setScope(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 2, border: '1px solid var(--line)', borderRadius: 999, padding: 2 }}>
                {PERIODS.map((p) => (
                  <button key={p.key} className={`period ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <AreaChart
                values={history?.values ?? []}
                times={history?.times ?? []}
                period={period}
                height="clamp(160px,26vw,240px)"
              />
            </div>
          </>
        ) : null}

        {/* add wallet */}
        {isOwner ? (
          <div style={{ marginTop: 30 }}>
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
              <div className="mono" style={{ marginTop: 7, fontSize: 10.5, color: 'var(--down)' }}>
                {addErr}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* unclaimed rewards across every wallet */}
        <RewardsStrip totals={rewards} />

        {/* wallets */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 30, marginBottom: 10 }}>
          <div className="eyebrow">WALLETS · SORTED BY VALUE</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--mut)' }}>
            USD
          </div>
        </div>

        {data.wallets.length === 0 ? (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
            {isOwner
              ? 'No wallets yet. Paste an address above — the network is detected automatically.'
              : 'This portfolio has no wallets yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.wallets.map((w) => (
              <WalletRow
                key={w.id}
                wallet={w}
                isOwner={isOwner}
                total={data.totalUsd}
                onRemove={() => void removeWallet(w.id)}
                onRename={(label) => void renameWallet(w.id, label)}
              />
            ))}
          </div>
        )}

        <div className="mono" style={{ marginTop: 36, textAlign: 'center', fontSize: 10.5, color: 'var(--mut)', lineHeight: 1.8 }}>
          <a href={window.location.href}>{window.location.host}/p/{data.slug}</a> ·{' '}
          {data.visibility === 'private'
            ? 'private — not listed anywhere; anyone with this link can view it'
            : 'anyone can view without signing in'}
        </div>
      </div>

      {confirmPublic ? (
        <GoPublicModal onCancel={() => setConfirmPublic(false)} onConfirm={() => void setVisibility(true)} />
      ) : null}
      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
