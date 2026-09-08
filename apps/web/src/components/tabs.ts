'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AGENT_ENABLED } from '../lib/agent';
import type { Tab } from './SideNav';

/**
 * Which pages there are, and how a finger moves between them.
 *
 * No longer a component: the strip is AppHeader's, in the kit, so the
 * portfolio and the assistant cannot end up drawing two different ones. What
 * stays here is the list they both count off and the gesture that turns the
 * pages, neither of which is anything to look at.
 */

/**
 * The pages, in the order they sit in — and the order a finger swipes them.
 *
 * The agent is in the list only once it is switched on (see AGENT_ENABLED).
 * Everything counts off this array — the strip, the rail, and how many pages
 * the pager has — so leaving it out is the whole of hiding it here, and there
 * is no way for the phone to reach a page the rail does not offer.
 */
export const tabsFor = (isAdmin: boolean): Array<{ key: Tab; label: string }> => [
  // AI comes first because it is the way in now: the assistant answers the
  // question a portfolio page makes you go and look up, and it can reach
  // everything else on your behalf. The portfolio is what it talks about.
  ...(AGENT_ENABLED ? ([{ key: 'agent', label: 'AI' }] as const) : []),
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'notifications', label: 'Alerts' },
  // Admin comes last and only for an admin, so everybody else's strip is
  // exactly what it was and there is no page for a phone to swipe to
  ...(isAdmin ? ([{ key: 'admin', label: 'Admin' }] as const) : []),
];

/** Where a fresh visit lands: the assistant when there is one, else the portfolio. */
export const homeTab = (): Tab => (AGENT_ENABLED ? 'agent' : 'portfolio');

/** Where a tab sits on the strip. The rail and the pager both count from here. */
export const tabIndex = (tab: Tab, isAdmin: boolean): number =>
  Math.max(0, tabsFor(isAdmin).findIndex((t) => t.key === tab));

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
      // Whole screens, not a fraction of a track whose width depends on how
      // many pages there are. A percentage in `transform` is read against this
      // element's own width, and the track is exactly one screen wide, so
      // -100% is one page across however many pages exist — see .pager.
      transform: `translateX(calc(${index * -100}% + ${drag.x}px))`,
      // Nothing to animate while the finger is the one moving it
      transition: drag.dragging ? 'none' : 'transform 0.44s cubic-bezier(0.3,1.25,0.5,1)',
    } as CSSProperties,
  };
}
