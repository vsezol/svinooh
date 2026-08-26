import type { PortfolioVisibility } from '@svinooh/shared';
import { Modal } from './Modal';

/**
 * The owner's visibility switch, in the top-right beside Share. Both states are
 * spelled out and always visible — an unlabelled toggle makes you flip it to
 * learn what it does — and what each one means is spelled out again in the
 * status line under the total.
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
      role="group"
      aria-label="Portfolio visibility"
      style={{
        display: 'flex',
        gap: 2,
        border: '1px solid var(--line2)',
        borderRadius: 999,
        padding: 2,
        opacity: busy ? 0.5 : 1,
      }}
    >
      {/* Private on the left as the resting default, Public on the right */}
      <Half label="Private" active={!isPublic} onClick={onGoPrivate} busy={busy} />
      <Half label="Public" active={isPublic} accent onClick={onGoPublic} busy={busy} />
    </div>
  );
}

function Half({
  label,
  active,
  accent,
  busy,
  onClick,
}: {
  label: string;
  active: boolean;
  accent?: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      disabled={busy || active}
      onClick={onClick}
      style={{
        fontFamily: 'var(--sans)',
        fontSize: 12,
        fontWeight: 700,
        padding: '6px 14px',
        borderRadius: 999,
        border: 'none',
        cursor: busy || active ? 'default' : 'pointer',
        color: active ? (accent ? 'var(--acc-ink)' : 'var(--text)') : 'var(--mut)',
        background: active ? (accent ? 'var(--acc)' : 'var(--surf2)') : 'transparent',
      }}
    >
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
    <Modal onClose={onCancel}>
      <div
        style={{
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
    </Modal>
  );
}
