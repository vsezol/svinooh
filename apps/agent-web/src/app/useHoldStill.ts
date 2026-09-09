import { useEffect } from 'react';

/** The two things in the chat that are allowed to move under a finger. */
const SCROLLERS = '.sv-a-log, [data-no-swipe]';

/**
 * Hold the page still while the composer has focus.
 *
 * iOS does not shrink the layout viewport for the keyboard: it slides the
 * visible window up so the focused field clears the keys, and leaves a page
 * taller than the window behind it. A finger can then go on panning that
 * window, and the composer rides away from the keyboard it was sitting on.
 *
 * `overflow: hidden` on html and body does not stop this — Mobile Safari
 * scrolls anyway, which is why the lock the chat already sets never held. What
 * does stop it is taking the gesture: a touchmove that did not begin inside
 * something the chat means to scroll is cancelled, so there is no scroll left
 * for Safari to turn into a pan.
 *
 * Nothing here resizes anything. Sizing the page to the keyboard was tried
 * twice and shipped twice and both times left the window framing the empty
 * space below a too-short page. The page keeps its height; only the gesture
 * changes, so the worst this can do is refuse a scroll that was never wanted.
 *
 * Only while focused, so a chat being read is untouched — and passive: false,
 * or the browser is entitled to ignore the preventDefault.
 */
export function useHoldStill(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const onTouchMove = (event: TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(SCROLLERS)) return;
      if (event.cancelable) event.preventDefault();
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, [active]);
}
