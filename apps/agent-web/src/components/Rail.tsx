import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const WIDTH_KEY = 'svinooh_agent_rail_width';
const MIN = 190;
const MAX = 420;
/* The design's sidebar width. The rail is resizable from here, but it opens
   on the number the design draws and the site's own rail keeps. */
const DEFAULT = 232;

function read(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A browser that refuses storage still gets a working rail, just a
    // forgetful one.
  }
}

interface Props {
  children: ReactNode;
}

/**
 * The side rail: draggable width, and it remembers it.
 *
 * It does not collapse. It used to, with a chevron parked in its bottom
 * corner — a control the design does not draw, on a rail whose whole job is
 * to show a list of titles you can read. The site's own rail lost the same
 * control for the same reason.
 *
 * The width lives in a CSS custom property rather than React state during a
 * drag — the pointer moves far more often than a chat needs to re-render, and
 * writing a variable skips the reconciler entirely. State is caught up once,
 * when the pointer is released.
 */
export function Rail({ children }: Props) {
  const [width, setWidth] = useState(DEFAULT);
  const rail = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  // Read once, on the client: the value lives in storage, which does not exist
  // while the page is being prepared.
  useEffect(() => {
    setWidth(read(WIDTH_KEY, DEFAULT));
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !rail.current) return;
    const next = Math.min(MAX, Math.max(MIN, event.clientX - rail.current.getBoundingClientRect().left));
    rail.current.style.setProperty('--sv-a-rail-width', `${next}px`);
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    const settled = rail.current?.style.getPropertyValue('--sv-a-rail-width');
    const value = Number.parseInt(settled || '', 10);
    if (Number.isFinite(value)) {
      setWidth(value);
      write(WIDTH_KEY, String(value));
    }
  }, []);

  return (
    <aside
      ref={rail}
      className="sv-a-rail"
      style={{ ['--sv-a-rail-width' as string]: `${width}px` }}
    >
      <div className="sv-a-rail-body">{children}</div>
      <div
        className="sv-a-rail-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </aside>
  );
}
