import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Panel } from './Surface';

/**
 * What closes something that is open over the page.
 *
 * Three components carried a copy of this and no two agreed. The wallet kebab
 * listened for mousedown, Escape, scroll and resize; the scope selector for
 * mousedown and Escape; the search results for neither — it closed on the
 * input's blur after a 150ms timer, which is a race with the click it exists to
 * receive.
 */
export function useDismiss({
  open,
  onClose,
  refs,
  /** Anchored to something that scrolls away: close rather than drift after it */
  closeOnScroll,
}: {
  open: boolean;
  onClose: () => void;
  /** Everything a click may land on without closing */
  refs: ReadonlyArray<RefObject<HTMLElement | null>>;
  closeOnScroll?: boolean;
}) {
  // The array is rebuilt by the caller on every render; reading it through a ref
  // keeps that from tearing down and rebuilding the listeners each time
  const inside = useRef(refs);
  inside.current = refs;

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!inside.current.some((r) => r.current?.contains(target))) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    if (closeOnScroll) {
      window.addEventListener('scroll', onClose, true);
      window.addEventListener('resize', onClose);
    }
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
      if (closeOnScroll) {
        window.removeEventListener('scroll', onClose, true);
        window.removeEventListener('resize', onClose);
      }
    };
  }, [open, onClose, closeOnScroll]);
}

const EDGE = 8;

/**
 * A menu on <body>, positioned against the thing that opened it.
 *
 * A portal because in place it is inside whatever card it belongs to, and that
 * card's `overflow: hidden` cuts it in half. Nothing an ancestor does can crop
 * it here, and it flips above its anchor when there is no room below.
 */
export function AnchoredMenu({
  open,
  onClose,
  anchor,
  width,
  gap = 6,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  width: number;
  gap?: number;
  label: string;
  children: React.ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useDismiss({ open, onClose, refs: [menu, anchor], closeOnScroll: true });

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const height = menu.current?.offsetHeight ?? 0;
      const below = rect.bottom + gap;
      const top =
        below + height > window.innerHeight - EDGE ? Math.max(EDGE, rect.top - gap - height) : below;
      const left = Math.min(Math.max(EDGE, rect.right - width), window.innerWidth - width - EDGE);
      setPos({ top, left });
    };
    place();
    // Measuring again once the menu exists gives the flip its real height
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, width, gap]);

  if (!open) return null;

  return createPortal(
    <Panel
      ref={menu}
      role="menu"
      aria-label={label}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        zIndex: 900,
        // Placed off-screen for the frame it takes to measure; hidden rather
        // than moved so it never flashes in the corner
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </Panel>,
    document.body,
  );
}
