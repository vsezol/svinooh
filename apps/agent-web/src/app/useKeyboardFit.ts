import { useEffect, useRef, useState } from 'react';

/** How long the height has to hold still before it counts as the keyboard's. */
const SETTLE_MS = 140;
/** Below this, a change is the URL bar breathing rather than a keyboard. */
const KEYBOARD_MIN = 120;

/**
 * The chat's height while the keyboard is up, published as a custom property.
 *
 * iOS Safari does not shrink the layout viewport for the keyboard. It slides
 * the visible window up instead, which puts the composer above the keys — and
 * leaves a page taller than the window, which the finger can then go on
 * panning. That is the complaint: the composer sits right where it should
 * until you drag, and then it rides away.
 *
 * Nothing can stop that pan. What removes it is leaving nothing to pan: a page
 * exactly as tall as what is visible.
 *
 * This was tried before by tracking `visualViewport.height` and it shipped and
 * it was worse, because that number arrives late on Safari — the chat resized
 * a beat behind the keys and settled at a size that fitted neither state. The
 * difference here is that nothing is read while the keyboard is moving. The
 * height is sampled only once it has held still for SETTLE_MS, which is one
 * step at the end rather than an argument all the way through, and only while
 * the composer has focus. Blur puts it back.
 *
 * Consumed by `.sv-a-root[data-variant='standalone']` and, on the site, by
 * `.agent-embed` — both of which fall back to 100dvh when it is unset, which
 * is every browser that shrinks its own viewport and every moment the
 * composer is not focused.
 */
export function useKeyboardFit(): { onFocus: () => void; onBlur: () => void } {
  const [focused, setFocused] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = document.documentElement;
    const clear = () => root.style.removeProperty('--sv-a-vh');

    if (!focused || !vv) {
      clear();
      return;
    }

    // The window's own height, for telling a keyboard from a toolbar.
    const full = window.innerHeight;

    const settle = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const taken = full - vv.height;
        // A keyboard takes a large bite. Anything small is the URL bar, and
        // resizing the chat for that would move it while somebody reads.
        if (taken >= KEYBOARD_MIN) root.style.setProperty('--sv-a-vh', `${Math.round(vv.height)}px`);
        else clear();
      }, SETTLE_MS);
    };

    settle();
    vv.addEventListener('resize', settle);
    return () => {
      vv.removeEventListener('resize', settle);
      if (timer.current !== null) window.clearTimeout(timer.current);
      clear();
    };
  }, [focused]);

  return { onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}
