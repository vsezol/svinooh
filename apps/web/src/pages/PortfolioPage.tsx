import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HistoryDto, HistoryRange, PortfolioDto } from '@svinooh/shared';
import { AreaChart } from '../components/AreaChart';
import { AuthModal } from '../components/AuthModal';
import { Logo } from '../components/Logo';
import { WalletRow } from '../components/WalletRow';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtUsd, walletName } from '../lib/format';
import { useTheme } from '../lib/theme';

const PERIODS: Array<{ key: HistoryRange; label: string }> = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'ALL' },
];

function usePortfolio(slug: string) {
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
    setData(null);
    setError(null);
    void reload();
  }, [reload]);

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

/** История для выбранного scope (весь портфель / конкретный кошелёк) и периода */
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
  const { me, config, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { data, error, reload } = usePortfolio(slug);

  const [scope, setScope] = useState<string>('all');
  const [period, setPeriod] = useState<HistoryRange>('30d');
  const [authOpen, setAuthOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const history = useHistory(slug, scope, period, data?.updatedAt ?? null);

  // выбранный кошелёк удалили — назад к «всему портфелю»
  useEffect(() => {
    if (scope !== 'all' && data && !data.wallets.some((w) => w.id === scope)) setScope('all');
  }, [data, scope]);

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

  const renameWallet = async (walletId: string, label: string) => {
    try {
      await api(`/portfolios/${slug}/wallets/${walletId}`, { method: 'PATCH', body: JSON.stringify({ label }) });
      await reload();
    } catch {
      // не сохранилось — вернётся прежнее имя при следующем reload
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
  const syncMins = data.updatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(data.updatedAt).getTime()) / 60000))
    : null;
  const syncLabel = syncMins === null ? '—' : syncMins < 1 ? 'JUST NOW' : `${syncMins}M AGO`;

  const scopeChips = [
    { id: 'all', label: 'ALL WALLETS' },
    ...data.wallets
      .filter((w) => w.status !== 'pending')
      .map((w) => ({ id: w.id, label: walletName(w.label, w.chain).toUpperCase() })),
  ];

  return (
    <div>
      {/* публичный баннер */}
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
          <div className="mono" style={{ fontSize: 11, color: 'var(--mut)', letterSpacing: '0.03em' }}>
            Viewing{' '}
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>
              {data.owner.username ? `@${data.owner.username}` : data.owner.name}
            </span>
            ’s public portfolio · read-only
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

      {/* хедер */}
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
        {/* тотал */}
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
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: change.up ? 'var(--up)' : 'var(--down)' }}>
                  {(change.up ? '+$' : '−$') +
                    Math.abs(change.chg).toLocaleString('en-US', { maximumFractionDigits: 0 }) +
                    ' (' +
                    (change.up ? '+' : '') +
                    change.pct.toFixed(2) +
                    '%) · ' +
                    period.toUpperCase()}
                </div>
              ) : null}
            </div>
          </div>
          <div
            className="mono"
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, color: 'var(--mut)', letterSpacing: '0.04em', paddingBottom: 6 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--acc)', animation: 'svpulse 2.4s ease infinite' }} />
            <span>
              AUTO-TRACKED · {config?.syncIntervalMin ?? 5} MIN · SYNCED {syncLabel}
            </span>
          </div>
        </div>

        {/* чипы + периоды */}
        {data.wallets.length > 0 ? (
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

        {/* добавить кошелёк */}
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

        {/* кошельки */}
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
          public link · <a href={window.location.href}>{window.location.host}/p/{data.slug}</a> · anyone can view without signing in
        </div>
      </div>

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
