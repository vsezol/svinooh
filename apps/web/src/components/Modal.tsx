import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dialog rendered into <body> rather than into the page.
 *
 * In place it sat inside the portfolio's own tree, where the sticky header and
 * the chart each create their own stacking context — so the chart could paint
 * over it and the scrim flickered as the compositor fought over what was on
 * top. A portal puts it outside all of that, and the scrim is a plain colour:
 * a blurred backdrop over a full page repaints on every mouse move, which is
 * what made the interface strobe.
 *
 * Escape and a click outside both close it; the page behind doesn't scroll.
 */
export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
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
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380 }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
