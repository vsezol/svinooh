'use client';
// Hooks and portals: a shipped kit must declare its client components
// itself — the app that imports it may be a server component.
import { useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'md' | 'lg';
  /**
   * `pill` for one long value read across — an address, a name.
   * `box` for a number read against the numbers above and below it.
   */
  shape?: 'pill' | 'box';
  /** Sets the field in the mono face, for anything that is data */
  mono?: boolean;
  invalid?: boolean;
}

export function Input({ size = 'lg', shape = 'pill', mono, invalid, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={['ui-input', rest.className].filter(Boolean).join(' ')}
      data-size={size}
      data-shape={shape}
      data-mono={mono ? 'true' : undefined}
      data-invalid={invalid ? 'true' : undefined}
    />
  );
}

interface CommittedProps extends Omit<InputProps, 'value' | 'onChange' | 'defaultValue'> {
  /** What is actually saved. `null` is an empty field. */
  value: number | null;
  /** Text to number. Returning null means "the field is empty". */
  parse: (raw: string) => number | null;
  /** Keystroke filter, applied as it is typed */
  clean?: (raw: string) => string;
  onCommit: (value: number | null) => void;
}

/**
 * A number that is saved when you are finished with it, not as you type.
 *
 * Held as text while it is being edited — "1." is not a number and neither is
 * an empty box, and rewriting either into one under the cursor is how a field
 * stops letting you clear it. What is typed is committed on blur, on Enter, and
 * discarded on Escape.
 *
 * The three things this gets right, each of which was a bug in the one place
 * this behaviour previously existed:
 *
 *  - Enter commits ITSELF rather than only calling blur() and leaving the
 *    saving to the blur handler. A value typed and confirmed with Enter used to
 *    sit on screen looking committed, having never been sent anywhere.
 *  - `sent` remembers the last value actually passed up. Enter commits and then
 *    blurs, and the blur commits again before the parent's state has come back
 *    round — without it every value confirmed with Enter was saved twice.
 *  - Somebody else's change to the same value — another tab, a reload — replaces
 *    a draft nobody is holding.
 */
export function NumberField({ value, parse, clean, onCommit, ...rest }: CommittedProps) {
  const asText = value === null ? '' : String(value);
  const [draft, setDraft] = useState(asText);

  useEffect(() => setDraft(asText), [asText]);

  const sent = useRef(value);
  useEffect(() => {
    sent.current = value;
  }, [value]);

  const commit = (raw: string = draft) => {
    const parsed = parse(raw);
    setDraft(parsed === null ? '' : String(parsed));
    if (parsed === sent.current) return;
    sent.current = parsed;
    onCommit(parsed);
  };

  return (
    <Input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(clean ? clean(e.target.value) : e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value);
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setDraft(asText);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
