import type { PortfolioVisibility } from '@svinooh/shared';

const LOCK = (
  <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.3}>
    <rect x="2.2" y="5.2" width="7.6" height="5.3" rx="1.2" />
    <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4" />
  </svg>
);

const GLOBE = (
  <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.3}>
    <circle cx="6" cy="6" r="4.3" />
    <path d="M1.7 6h8.6M6 1.7c1.1 1.2 1.7 2.7 1.7 4.3S7.1 9.1 6 10.3C4.9 9.1 4.3 7.6 4.3 6S4.9 2.9 6 1.7Z" />
  </svg>
);

/**
 * The owner's visibility switch, sitting in the top-right above the chart —
 * the first thing they see about their own portfolio, because it decides who
 * else sees their balances.
 *
 * Both states are spelled out and always visible: an unlabelled toggle makes
 * you guess which way is "on". Private sits on the left as the default and
 * resting state; going public is deliberate and passes through a confirmation.
 */
export function VisibilityCard({
  visibility,
  busy,
  onGoPublic,
  onGoPrivate,
}: {
  visibility: PortfolioVisibility;
  busy: boolean;
  onGoPublic: () => void;
  onGoPrivate: () => void;
}) {
  // An anonymous portfolio has no owner to be private from, so there is nothing
  // to switch — it should never reach this component, but be explicit.
  if (visibility === 'anonymous') return null;
  const isPublic = visibility === 'public';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
      <div
        role="group"
        aria-label="Portfolio visibility"
        style={{
          display: 'flex',
          gap: 2,
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: 2,
          opacity: busy ? 0.5 : 1,
        }}
      >
        <Half label="PRIVATE" icon={LOCK} active={!isPublic} onClick={onGoPrivate} busy={busy} />
        <Half label="PUBLIC" icon={GLOBE} active={isPublic} accent onClick={onGoPublic} busy={busy} />
      </div>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--mut)', letterSpacing: '0.04em' }}>
        {isPublic ? 'Listed on the home page' : 'Only people with the link'}
      </span>
    </div>
  );
}

function Half({
  label,
  icon,
  active,
  accent,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  accent?: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="period"
      aria-pressed={active}
      disabled={busy || active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        cursor: busy || active ? 'default' : 'pointer',
        color: active ? (accent ? 'var(--acc-text)' : 'var(--text)') : 'var(--mut)',
        background: active ? (accent ? 'var(--acc-soft)' : 'var(--surf2)') : 'transparent',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Publishing is the one direction that can't be undone for anyone who already
 * saw the page, so it gets an explicit "here is what changes" step. Going back
 * to private needs no confirmation.
 */
export function GoPublicModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'color-mix(in srgb, var(--bg) 65%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--surf)',
          border: '1px solid var(--line2)',
          borderRadius: 20,
          padding: '26px 24px',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 17 }}>Make this portfolio public?</div>
        <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 12, lineHeight: 1.7 }}>
          It will appear on the home page and in search, and <strong style={{ color: 'var(--text)' }}>anyone
          will be able to see your total and every wallet in it</strong>.
          <br />
          <br />
          Your name, your Telegram handle and the names you gave your wallets stay private either way —
          those are never shown to anyone but you. You can switch back at any time.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button
            className="pill"
            style={{ flex: 1, height: 42, justifyContent: 'center', fontSize: 12 }}
            onClick={onCancel}
          >
            CANCEL
          </button>
          <button className="btn-acc" style={{ flex: 1, height: 42, fontSize: 13 }} onClick={onConfirm}>
            Make public
          </button>
        </div>
      </div>
    </div>
  );
}
