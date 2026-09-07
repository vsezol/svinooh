import type { ComponentPropsWithRef, ReactNode } from 'react';

export type TagVariant = 'outline' | 'soft' | 'bare';

interface Shared {
  variant?: TagVariant;
  size?: 'sm' | 'md';
  /** Chosen. `neutral` is a change of view, `accent` a filter switched on. */
  active?: boolean;
  tone?: 'neutral' | 'accent';
  children?: ReactNode;
}

/**
 * A label, set in mono and tracked — the shape this design uses for a period,
 * a filter, a chain, a status, and anything else that is a word about the page
 * rather than a verb aimed at it.
 *
 * Pressable when it is given an onClick, inert otherwise, and the same size
 * either way: a filter you can turn off and a badge you cannot should not be
 * two different heights on the same row.
 */
export function Tag({
  variant = 'outline',
  size = 'md',
  active,
  tone = 'neutral',
  children,
  ...rest
}: Shared & ComponentPropsWithRef<'span'>) {
  return (
    <span
      {...rest}
      className={['ui-tag', rest.className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-active={active ? 'true' : undefined}
      data-tone={tone}
    >
      {children}
    </span>
  );
}

export function TagButton({
  variant = 'outline',
  size = 'md',
  active,
  tone = 'neutral',
  children,
  ...rest
}: Shared & ComponentPropsWithRef<'button'>) {
  return (
    <button
      {...rest}
      className={['ui-tag', rest.className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-active={active ? 'true' : undefined}
      data-tone={tone}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
