import type { PortfolioVisibility } from '@svinooh/shared';
import { Button, Dialog, DialogActions, Note } from '../ui';

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
        gap: 'var(--sp-1)',
        border: '1px solid var(--line2)',
        borderRadius: 'var(--r-full)',
        padding: 'var(--sp-1)',
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
        fontSize: 'var(--fs-note)',
        fontWeight: 'var(--fw-bold)',
        padding: 'var(--sp-3) 14px',
        borderRadius: 'var(--r-full)',
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
    <Dialog onClose={onCancel} title="Make this portfolio public?">
      <div style={{ fontSize: 'var(--fs-title)', fontWeight: 'var(--fw-heavy)' }}>
        Make this portfolio public?
      </div>
      <Note style={{ marginTop: 'var(--sp-5)', lineHeight: 1.7 }}>
          It will appear on the home page and in search, and <strong style={{ color: 'var(--text)' }}>anyone
          will be able to see your total and every wallet in it</strong>.
          <br />
          <br />
          Your name, your Telegram handle and the names you gave your wallets stay private either way —
          those are never shown to anyone but you. You can switch back at any time.
      </Note>
      <DialogActions>
        <Button variant="quiet" size="lg" block onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" block onClick={onConfirm}>
          Make public
        </Button>
      </DialogActions>
    </Dialog>
  );
}
