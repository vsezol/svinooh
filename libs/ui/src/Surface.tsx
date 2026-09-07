import type { ComponentPropsWithRef, ReactNode } from 'react';

/** A block ON the page: a wallet, a settings group, a panel of figures. */
export function Card({ children, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div {...rest} className={['ui-card', rest.className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/**
 * A surface OVER the page: a menu, a dropdown, a dialog's body.
 *
 * Three of these were written out separately, and the giveaway was the shadow —
 * `0 20px 50px -20px rgba(0,0,0,0.55)` twice and `0 24px 60px -30px
 * rgba(0,0,0,0.6)` once, none of which was a decision about that particular
 * menu. It is one token now, and it is lighter in the light theme, where a
 * 55%-black plume reads as grime rather than height.
 */
export function Panel({ size, children, ...rest }: ComponentPropsWithRef<'div'> & { size?: 'lg' }) {
  return (
    <div {...rest} className={['ui-panel', rest.className].filter(Boolean).join(' ')} data-size={size}>
      {children}
    </div>
  );
}

/** A line in a menu — full width, left-aligned, the whole row a target. */
export function MenuItem({
  tone,
  selected,
  children,
  ...rest
}: ComponentPropsWithRef<'button'> & { tone?: 'danger'; selected?: boolean; children?: ReactNode }) {
  return (
    <button
      {...rest}
      className={['ui-menu-item', rest.className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-selected={selected ? 'true' : undefined}
    >
      {children}
    </button>
  );
}

/**
 * A fact on one line: the label keeps the left edge, the value the right.
 *
 * Written out fifteen times as a flex row with `space-between` — which is fine
 * until half of them align on `center` and half on `baseline`, and a column of
 * them no longer lines up.
 */
export function Row({
  label,
  children,
  align = 'baseline',
  ...rest
}: ComponentPropsWithRef<'div'> & { label: ReactNode; align?: 'baseline' | 'center' }) {
  return (
    <div
      {...rest}
      style={{
        display: 'flex',
        alignItems: align,
        justifyContent: 'space-between',
        gap: 'var(--sp-5)',
        ...rest.style,
      }}
    >
      <span className="ui-eyebrow" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 'var(--fs-note)', textAlign: 'right', minWidth: 0 }}>{children}</span>
    </div>
  );
}
