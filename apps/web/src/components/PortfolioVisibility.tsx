import type { PortfolioVisibility } from '@svinooh/shared';

/**
 * The owner's visibility switch, sitting above the wallets — the first thing
 * they see about their own portfolio, because it decides who else sees their
 * balances. Private is the default and the resting state; going public is a
 * deliberate step and passes through a confirmation.
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
    <div
      className="card"
      style={{
        marginTop: 26,
        padding: '13px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 190 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>{isPublic ? 'Public' : 'Private'}</span>
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: '0.1em',
              color: isPublic ? 'var(--acc-text)' : 'var(--mut)',
              border: `1px solid ${isPublic ? 'color-mix(in srgb, var(--acc) 45%, transparent)' : 'var(--line2)'}`,
              borderRadius: 5,
              padding: '1px 6px',
            }}
          >
            VISIBILITY
          </span>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--mut)', marginTop: 4, lineHeight: 1.6 }}>
          {isPublic
            ? 'Listed on the home page and findable in search. Your balances are visible to everyone.'
            : 'Not listed and not findable. Only someone you give the link to can open it.'}
        </div>
      </div>

      <button
        onClick={isPublic ? onGoPrivate : onGoPublic}
        disabled={busy}
        aria-pressed={isPublic}
        title={isPublic ? 'Make private' : 'Make public'}
        style={{
          width: 52,
          height: 28,
          borderRadius: 999,
          border: `1px solid ${isPublic ? 'transparent' : 'var(--line2)'}`,
          background: isPublic ? 'var(--acc)' : 'var(--surf2)',
          padding: 2,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          display: 'flex',
          justifyContent: isPublic ? 'flex-end' : 'flex-start',
          transition: 'background 0.15s ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: isPublic ? 'var(--acc-ink)' : 'var(--mut)',
            transition: 'background 0.15s ease',
          }}
        />
      </button>
    </div>
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
          <button
            className="btn-acc"
            style={{ flex: 1, height: 42, fontSize: 13 }}
            onClick={onConfirm}
          >
            Make public
          </button>
        </div>
      </div>
    </div>
  );
}
