'use client';

import { useCallback, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Chevron } from './Disclosure';
import { useDismiss } from './Popover';
import { MenuItem, Panel } from './Surface';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Held against the right edge of the row — a total, a count, a unit */
  hint?: ReactNode;
}

/**
 * One of a few, chosen from a list the app draws itself.
 *
 * NOT a native <select>. The browser hands that one to the operating system:
 * the list is drawn in the OS's own type on the OS's own surface, with the
 * OS's tick mark beside the current value, and none of it takes the app's
 * theme, radius, spacing or colours. Beside a menu this app drew — the
 * portfolio switcher, three pixels above it — it reads as a piece of a
 * different program, because it is one.
 *
 * So the trigger is a button and the list is a Panel of MenuItems: the same
 * two pieces every other menu here is made of, dismissed by the same
 * `useDismiss`, marked with the same Chevron. Two components had already built
 * this by hand before this existed; they build it from here now.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  /** Extra rows under the options, below a rule — "New portfolio" and its like */
  footer,
  /** What the trigger shows when `value` matches no option */
  placeholder = '—',
  mono,
  align = 'left',
  width,
  minMenuWidth = 160,
  triggerStyle,
  className,
}: {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  /** Names the control for a screen reader */
  label: string;
  footer?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  /** Which edge the menu hangs from — `right` when the trigger sits at the right of a row */
  align?: 'left' | 'right';
  width?: number | string;
  minMenuWidth?: number;
  triggerStyle?: CSSProperties;
  /** On the root, so a marker class (ph-mask) covers the trigger and the menu alike */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onClose: close, refs: [box] });

  const current = options.find((o) => o.value === value);

  return (
    <div ref={box} className={className} style={{ position: 'relative', minWidth: 0, flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="ui-select"
        data-open={open ? 'true' : undefined}
        style={{ width, ...triggerStyle }}
      >
        <span
          className={mono ? 'mono' : undefined}
          style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {current?.label ?? placeholder}
        </span>
        <Chevron open={open} />
      </button>

      {open ? (
        <Panel
          role="listbox"
          aria-label={label}
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--sp-3))',
            [align]: 0,
            minWidth: minMenuWidth,
            zIndex: 70,
            padding: 'var(--sp-2)',
          }}
        >
          {options.map((o) => (
            <MenuItem
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              selected={o.value === value}
              onClick={() => {
                close();
                if (o.value !== value) onChange(o.value);
              }}
              style={o.hint === undefined ? undefined : { justifyContent: 'space-between', gap: 14 }}
            >
              <span
                className={mono ? 'mono' : undefined}
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {o.label}
              </span>
              {o.hint === undefined ? null : o.hint}
            </MenuItem>
          ))}
          {footer ? (
            <>
              <div style={{ borderTop: '1px solid var(--line)', margin: 'var(--sp-2) 0' }} />
              {footer}
            </>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
