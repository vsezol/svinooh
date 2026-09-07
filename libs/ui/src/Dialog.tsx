'use client';
// Hooks and portals: a shipped kit must declare its client components
// itself — the app that imports it may be a server component.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dialog rendered into <body> rather than into the page.
 *
 * In place it sat inside the portfolio's own tree, where the sticky header and
 * the chart each create their own stacking context — so the chart could paint
 * over it and the scrim flickered as the compositor fought over what was on
 * top. A portal puts it outside all of that, and the scrim is a plain colour: a
 * blurred backdrop over a full page repaints on every mouse move, which is what
 * made the interface strobe.
 *
 * Escape and a click outside both close it; the page behind doesn't scroll.
 */
export function Dialog({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  /** Names the dialog for a screen reader, and heads it on screen */
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--sp-6)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--surf)',
          border: '1px solid var(--line2)',
          borderRadius: 'var(--r-xl)',
          padding: '26px var(--sp-7)',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The row a dialog ends with. Both buttons take half the width, so neither one
 * is the bigger target — the difference between them is stated by their colour,
 * which is a thing you read rather than a thing you hit by accident.
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 'var(--sp-4)', marginTop: 22 }}>{children}</div>;
}
