import { useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Escape + outside-press dismissal shared by the popover panels. The listeners
 * attach after the opening click's own events have fired, so opening never
 * immediately closes.
 */
export function useDismiss(active: boolean, onClose: (() => void) | undefined, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active || !onClose) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, onClose, ref]);
}

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Mobile bottom sheet: scrim, bottom-anchored panel, drag notch. */
export function Sheet({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    // Freeze the page behind the sheet - inside svinooh.com the host page
    // could otherwise scroll under the scrim.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portaled to <body>: the embedded host animates its tab panes with
  // transforms, which would turn position:fixed into a pane-local box.
  return createPortal(
    <div
      className="sv-a-c-sheet-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sv-a-c-sheet" role="dialog" aria-modal="true">
        <div className="sv-a-c-sheet-notch" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
