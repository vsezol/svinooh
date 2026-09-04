import type { CSSProperties, ReactNode } from 'react';

/**
 * A name or a sentence, on hover and on focus.
 *
 * The native `title` attribute was the app's answer in thirteen places and it
 * is the wrong one: the browser waits about a second, draws it in the operating
 * system's type, and shows a finger nothing at all. This appears at once, in the
 * app's own type, and a keyboard can reach it.
 *
 *  - `size="sm"` (the default) is a name on one line, above the thing.
 *  - `size="lg"` is a sentence that wraps, below it.
 *  - `anchor="row"` hands the positioning to the nearest positioned ancestor,
 *    for a mark sitting mid-line where a centred popover would run off a phone.
 */
export function Tooltip({
  text,
  label,
  size = 'sm',
  anchor,
  focusable,
  style,
  children,
}: {
  /** What it says. A string is the usual case; a node for anything with structure. */
  text: ReactNode;
  /** The accessible name, when `text` is not a plain string to borrow it from */
  label?: string;
  size?: 'sm' | 'lg';
  anchor?: 'row';
  /**
   * Makes the wrapper itself a tab stop.
   *
   * Off by default, and deliberately: most of these sit on a figure that is
   * already surrounded by figures, and a tab stop on each would turn a table
   * into a hundred of them. On when there is nothing else to focus — the info
   * mark exists only to be hovered, so a keyboard has to be able to reach it.
   * Where the tooltip wraps something already focusable, `:focus-within` in the
   * stylesheet reveals it without a second stop.
   */
  focusable?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <span
      className="ui-tip"
      data-anchor={anchor}
      tabIndex={focusable ? 0 : undefined}
      role="note"
      aria-label={label ?? (typeof text === 'string' ? text : undefined)}
      style={style}
    >
      {children}
      <span className="ui-tip-pop" data-size={size === 'lg' ? 'lg' : undefined} aria-hidden>
        {text}
      </span>
    </span>
  );
}

/** The ringed italic i that opens a Tooltip — used where there is nothing else to hover. */
export function InfoTip({ text, label, anchor }: { text: ReactNode; label?: string; anchor?: 'row' }) {
  return (
    <Tooltip text={text} label={label ?? 'More about this setting'} size="lg" anchor={anchor} focusable>
      <span className="ui-tip-mark" aria-hidden>
        i
      </span>
    </Tooltip>
  );
}
