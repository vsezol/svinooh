import type { HTMLAttributes } from 'react';

/** The smallest label there is: mono, tracked wide, muted. Signage. */
export function Eyebrow({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={['ui-eyebrow', rest.className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/** Small print — the sentence under a setting saying what it does. */
export function Note({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={['ui-note', rest.className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/** The top of a dialog or a section. */
export function Title({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={['ui-title', rest.className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/** The name of a page. */
export function Display({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={['ui-display', rest.className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
