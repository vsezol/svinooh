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
  // The portfolio stays first while the assistant is still growing into the
  // job. It will lead when it can carry a first visit on its own; today the
  // page is what somebody came for.
  { key: 'portfolio', label: 'Portfolio' },
  ...(AGENT_ENABLED ? ([{ key: 'agent', label: 'AI' }] as const) : []),
  { key: 'notifications', label: 'Alerts' },
  // Admin comes last and only for an admin, so everybody else's strip is
  // exactly what it was and there is no page for a phone to swipe to
  ...(isAdmin ? ([{ key: 'admin', label: 'Admin' }] as const) : []),
];

/** Where a visit lands when the URL does not say. */
export const homeTab = (): Tab => 'portfolio';

/** The name a tab goes by in a link. */
export const TAB_PARAM = 'tab';

/** The tab a URL is asking for, or null when it names none we have. */
export const tabFromUrl = (value: string | null, isAdmin: boolean): Tab | null =>
  tabsFor(isAdmin).find((t) => t.key === value)?.key ?? null;

/** Where a tab sits on the strip. The rail and the pager both count from here. */
export const tabIndex = (tab: Tab, isAdmin: boolean): number =>
  Math.max(0, tabsFor(isAdmin).findIndex((t) => t.key === tab));

/** How far a finger has to carry the page before letting go turns it over */
const SWIPE_COMMIT = 70;
/**
 * How long a page takes to turn, in one place: the CSS transition below and
 * the timer that puts the other page away both read it, and a slide that
 * outlasts the timer is a page vanishing mid-turn.
 */
const SLIDE_MS = 440;
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
   * Which pages are on the strip, and when.
   *
   * Only ever two: the one being left and the one being landed on. Left side
   * by side at rest they are as tall as the tallest of them, and the shorter
   * pages end in a screenful of nothing to scroll through — so a page that is
   * not part of the turn folds away.
   *
   * It used to be every page while the strip moved, which is why tapping a tab
   * two along flew visibly through the one in between, and why the strip
   * carried four pages' worth of layer for Safari to rasterise on every frame
   * of a 440ms transform.
   *
   * `from` is derived during the render that changes `index`, not in an effect
   * afterwards. An effect runs after the browser has already been handed a
   * frame carrying the new transform — and on that frame the page being turned
   * to was still folded away, so a page turn began on a blank.
   */
  const [seen, setSeen] = useState(index);
  const [from, setFrom] = useState(index);
  const [sliding, setSliding] = useState(false);
  /** This render puts the strip somewhere rather than taking it there. */
  const [cut, setCut] = useState(false);
  if (seen !== index) {
    const neighbour = Math.abs(index - seen) === 1;
    setFrom(seen);
    setSeen(index);
    // Only neighbours turn. A tap two tabs along is a jump, and animating one
    // drags the strip across two screens with a page nobody asked for in the
    // middle of the journey — or, once that page is folded away, an empty
    // one. It cuts instead, which is what a jump looks like.
    setSliding(neighbour);
    setCut(!neighbour);
  }
  useEffect(() => {
    if (!sliding) return;
    // A hair past the slide, so the page being left is still there for the
    // last frame of it.
    const done = setTimeout(() => setSliding(false), SLIDE_MS + 20);
    return () => clearTimeout(done);
  }, [sliding, index]);
  // One frame without a transition is the whole of a cut. After the browser
  // has painted it, the transition goes back on against a transform that is
  // already where it belongs, so nothing moves — and the next page released
  // from a half-swipe still springs back rather than snapping.
  useEffect(() => {
    if (cut) setCut(false);
  }, [cut]);

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

  const moving = drag.dragging || sliding;

  return {
    /** Goes on the window that clips the strip */
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    /** True while more than one page has to be on the strip together */
    moving,
    /**
     * Whether the page at this position is drawn at all — see .pane[data-shown].
     *
     * At rest, the open one. Under a finger, it and both its neighbours: the
     * hand can go either way and finds out which as it moves. Mid-turn, the
     * one being left and the one being landed on, and nothing in between even
     * when the strip passes over it.
     */
    shows: (i: number) => {
      if (!moving) return i === index;
      if (drag.dragging) return Math.abs(i - index) <= 1;
      return i === index || i === from;
    },
    /** Goes on the strip itself */
    style: {
      // Whole screens, not a fraction of a track whose width depends on how
      // many pages there are. A percentage in `transform` is read against this
      // element's own width, and the track is exactly one screen wide, so
      // -100% is one page across however many pages exist — see .pager.
      transform: `translateX(calc(${index * -100}% + ${drag.x}px))`,
      // Nothing to animate while the finger is the one moving it, and nothing
      // to animate on a jump — see sliding above.
      //
      // The curve does not overshoot. It used to spring past the target by
      // about 2% and settle back, which on a strip of pages means eight pixels
      // of the page after the one you asked for, appearing at the edge and
      // then leaving again. A page turn has something real behind it; there is
      // nowhere for it to bounce into.
      transition:
        drag.dragging || cut ? 'none' : `transform ${SLIDE_MS}ms cubic-bezier(0.32,0.72,0,1)`,
    } as CSSProperties,
  };
}
