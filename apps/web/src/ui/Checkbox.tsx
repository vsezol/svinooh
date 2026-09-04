/**
 * A checkbox in the system's voice: an outlined box on a transparent ground,
 * the accent arriving only when it is ticked.
 *
 * A real <input type="checkbox"> under the drawing, for the same reason Switch
 * is a real button — the keyboard reaches it and a screen reader announces it,
 * with none of that re-implemented. The label is part of the control: small
 * print beside the box, and clicking either toggles it.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Small print beside the box — what ticking it does */
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="ui-checkbox" data-disabled={disabled || undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-checkbox-box" aria-hidden="true">
        <svg viewBox="0 0 10 8" fill="none">
          <path d="M1 4.2 3.6 6.8 9 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="ui-checkbox-label">{label}</span>
    </label>
  );
}
