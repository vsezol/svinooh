import type { ComponentPropsWithRef, ReactNode } from 'react';

export type ButtonVariant = 'accent' | 'soft' | 'quiet' | 'danger';
export type ControlSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Fills its container — a dialog's buttons, where the row is the measure */
  block?: boolean;
  /**
   * Swaps the label for a spinner and stops the button being pressed again.
   * Every busy button in the app used to write this out itself, which is why
   * there were nine spinners in four sizes and two of them were the wrong
   * colour for the button they were sitting on.
   */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * An action, set in sans.
 *
 * The other pressable thing in this interface is a Tag — mono, tracked, and a
 * label rather than a verb. They are separate components because they are
 * separate typefaces at separate sizes, and the one time they were the same
 * component the size had to be restated at every call site to get either of
 * them back.
 */
export function Button({
  variant = 'accent',
  size = 'md',
  block,
  loading,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={['ui-btn', rest.className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-block={block ? 'true' : undefined}
      disabled={disabled || loading}
    >
      {loading ? <Spinner size={size === 'lg' ? 15 : 14} on={variant === 'accent' ? 'accent' : undefined} /> : children}
    </button>
  );
}

interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  /** `outline` sits in a toolbar and needs an edge; `bare` sits in a row */
  variant?: 'outline' | 'bare';
  size?: 'xs' | 'sm';
  /** Names the button for a screen reader, and is what the tooltip says */
  label: string;
}

export function IconButton({ variant = 'outline', size = 'sm', label, children, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      className={['ui-icon-btn', rest.className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/**
 * The one spinner.
 *
 * `on` says what it is sitting on, because the default — a hairline track with
 * an accent head — is invisible on an accent button: the track is a dark line
 * colour on saturated green, and the head is that same green.
 */
export function Spinner({ size = 15, on }: { size?: number; on?: 'accent' }) {
  return <span className="ui-spin" data-on={on} style={{ width: size, height: size }} aria-hidden />;
}
