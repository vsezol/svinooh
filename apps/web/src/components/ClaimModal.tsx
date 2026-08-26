import { Modal } from './Modal';

/**
 * Taking over a portfolio that belongs to nobody. Worth a confirmation not
 * because it is destructive, but because it changes what other people see: the
 * portfolio is listed publicly while it is ownerless, and owning it makes it
 * private — anyone who found it through the home page will stop finding it.
 */
export function ClaimModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <div style={{ background: 'var(--surf)', border: '1px solid var(--line2)', borderRadius: 20, padding: '26px 24px' }}>
        <div style={{ fontWeight: 800, fontSize: 17 }}>Make this portfolio yours?</div>
        <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 12, lineHeight: 1.7 }}>
          It belongs to nobody right now. Taking it over lets you{' '}
          <strong style={{ color: 'var(--text)' }}>rename and remove its wallets</strong>, and nobody
          else will be able to add to it.
          <br />
          <br />
          It also becomes private — it leaves the home page and search, and only people you give the
          link to can open it. You can publish it again whenever you like.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button className="pill" style={{ flex: 1, height: 42, justifyContent: 'center', fontSize: 12 }} onClick={onCancel}>
            CANCEL
          </button>
          <button className="btn-acc" style={{ flex: 1, height: 42, fontSize: 13 }} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spin" style={{ width: 15, height: 15, borderTopColor: 'var(--acc-ink)' }} /> : 'Make it mine'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
