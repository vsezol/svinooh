/**
 * On or off, and which one it is has to be readable without touching it.
 *
 * A real <button role="switch">, so it is reachable by keyboard and announces
 * its state — it used to be a <div> with the role bolted on, which a keyboard
 * could not get to at all.
 */
export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** What is being switched, for anyone who cannot see the row it sits in */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className="ui-switch"
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}
