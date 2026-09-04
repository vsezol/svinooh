import { Button, Dialog, DialogActions, Note } from '../ui';

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
    <Dialog onClose={onCancel} title="Make this portfolio yours?">
      <div style={{ fontSize: 'var(--fs-title)', fontWeight: 'var(--fw-heavy)' }}>
        Make this portfolio yours?
      </div>
      <Note style={{ marginTop: 'var(--sp-5)', lineHeight: 1.7 }}>
        It belongs to nobody right now. Taking it over lets you{' '}
        <strong style={{ color: 'var(--text)' }}>rename and remove its wallets</strong>, and nobody
        else will be able to add to it.
        <br />
        <br />
        It also becomes private — it leaves the home page and search, and only people you give the
        link to can open it. You can publish it again whenever you like.
      </Note>
      <DialogActions>
        <Button variant="quiet" size="lg" block onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" block loading={busy} onClick={onConfirm}>
          Make it mine
        </Button>
      </DialogActions>
    </Dialog>
  );
}
