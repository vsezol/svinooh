'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AGENT_ENABLED } from '../lib/agent';
import type { Tab } from './SideNav';

/**
 * The pages, in the order they sit in — and the order a finger swipes them.
 *
 * The agent is in the list only once it is switched on (see AGENT_ENABLED).
 * Everything counts off this array — the strip, the moving underline, and how
 * many pages the pager has — so leaving it out is the whole of hiding it here,
 * and there is no way for the phone to reach a page the rail does not offer.
 */
export const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'notifications', label: 'Alerts' },
  ...(AGENT_ENABLED ? ([{ key: 'agent', label: 'AI agent' }] as const) : []),
];

/** Where a tab sits on the strip. The rail and the pager both count from here. */
export const tabIndex = (tab: Tab): number => Math.max(0, TABS.findIndex((t) => t.key === tab));

/** How far a finger has to carry the page before letting go turns it over */
const SWIPE_COMMIT = 70;
/** Past the first page and past the last one, the drag goes heavy instead of free */
const RUBBER = 0.25;
/**
 * A drag is a page turn or a scroll, never both — and which one is decided once,
 * from the first 10px of movement, then held for the rest of the gesture. The
 * 1.2 leans the tie towards scrolling: a finger heading down the page with a
 * little sideways drift means to scroll.
 */
const LOCK_AFTER = 10;
const LOCK_BIAS = 1.2;

const tabStyle = (active: boolean): CSSProperties => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 46,
  fontWeight: 700,
  fontSize: 13.5,
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  color: active ? 'var(--acc-text)' : 'var(--mut)',
  transition: 'color 0.25s ease',
});

/**
 * The phone's navigation: tabs across the top, the way a chat app does it,
 * rather than a bar along the bottom.
 *
 * It is rendered on every screen and the stylesheet decides who sees it — a
 * desktop keeps the rail beside the page. Deciding in JS instead would mean the
 * server rendering one of them blind and the browser correcting it, which is a
 * flash of the wrong navigation on every load.
 */
export function MobileTabs({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const index = tabIndex(tab);

  return (
    <div className="top-tabs">
      <div className="shell" style={{ position: 'relative', display: 'flex' }}>
        {TABS.map((t) => (
          <div key={t.key} onClick={() => onTab(t.key)} style={tabStyle(t.key === tab)}>
            {t.label}
          </div>
        ))}
        {/* One line that moves, rather than a border that appears under whichever
            tab is on — so the selection travels the distance the pages do */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: `${100 / TABS.length}%`,
            height: 3,
            borderRadius: '3px 3px 0 0',
            background: 'var(--acc)',
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.46s cubic-bezier(0.34,1.42,0.5,1)',
          }}
        />
      </div>
    </div>
  );
}

/**
 * The two pages, side by side on one strip that the finger drags.
 *
 * The strip follows the hand while it is down and is thrown to the nearest page
 * when it lifts, so a half-swipe shows half of each page rather than nothing
 * happening until some threshold is crossed. Only the phone has it: `.pager`
 * flattens back to one page per screen above the breakpoint.
 */
export function usePager(index: number, onIndex: (index: number) => void, count: number) {
  const [drag, setDrag] = useState({ x: 0, dragging: false });
  const gesture = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  /** The state lags a frame behind the finger; the release reads this instead */
  const dragX = useRef(0);

  /**
   * Both pages are only really there while one is on its way to replacing the
   * other. Left side by side at rest they are as tall as the taller of them,
   * and the shorter page ends in a screenful of nothing to scroll through —
   * so the one that isn't open folds away once the strip stops moving. The
   * timer is the slide's own length: fold it away any sooner and the page
   * being swiped away vanishes mid-swipe.
   */
  const [sliding, setSliding] = useState(false);
  const previous = useRef(index);
  useEffect(() => {
    if (previous.current === index) return;
    previous.current = index;
    setSliding(true);
    const done = setTimeout(() => setSliding(false), 460);
    return () => clearTimeout(done);
  }, [index]);

  const onTouchStart = (e: React.TouchEvent) => {
    // Some things on the page own the sideways drag themselves — the charts,
    // where it scrolls back through the history. A gesture that starts on one
    // of those is theirs, and the pager never sees it.
    if ((e.target as HTMLElement | null)?.closest?.('[data-no-swipe]')) {
      gesture.current = null;
      return;
    }
    const t = e.touches[0];
    gesture.current = { x: t.clientX, y: t.clientY, horizontal: null };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const t = e.touches[0];
    let dx = t.clientX - g.x;
    const dy = t.clientY - g.y;

    if (g.horizontal === null) {
      if (Math.abs(dx) < LOCK_AFTER && Math.abs(dy) < LOCK_AFTER) return;
      g.horizontal = Math.abs(dx) > Math.abs(dy) * LOCK_BIAS;
    }
    if (!g.horizontal) return;

    // There is nothing on the other side of the ends, so pulling towards it
    // gives — a quarter of the way — rather than moving the page
    if ((index === 0 && dx > 0) || (index === count - 1 && dx < 0)) dx *= RUBBER;
    dragX.current = dx;
    setDrag({ x: dx, dragging: true });
  };

  const onTouchEnd = () => {
    if (!gesture.current) return;
    gesture.current = null;
    const dx = dragX.current;
    dragX.current = 0;
    setDrag({ x: 0, dragging: false });
    if (dx < -SWIPE_COMMIT && index < count - 1) onIndex(index + 1);
    else if (dx > SWIPE_COMMIT && index > 0) onIndex(index - 1);
  };

  return {
    /** Goes on the window that clips the strip */
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    /** True while both pages have to be on the strip together */
    moving: drag.dragging || sliding,
    /** Goes on the strip itself */
    style: {
      transform: `translateX(calc(${(index * -100) / count}% + ${drag.x}px))`,
      // Nothing to animate while the finger is the one moving it
      transition: drag.dragging ? 'none' : 'transform 0.44s cubic-bezier(0.3,1.25,0.5,1)',
    } as CSSProperties,
  };
}
