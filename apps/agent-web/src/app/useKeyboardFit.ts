import { useEffect, useState } from 'react';

/** Below this, a change is the URL bar breathing rather than a keyboard. */
const KEYBOARD_MIN = 120;

/**
 * Fit the chat to what is visible while the keyboard is up, and put the window
 * back where it belongs.
 *
 * What iOS actually does, read off a simulator with the keyboard open rather
 * than guessed at:
 *
 *                        as it ships    with this
 *   window (innerHeight)     377px        714px
 *   visualViewport.height    377px        377px
 *   scrollY                  337px          0px
 *   visualViewport.offsetTop 337px          0px
 *
 * So `100dvh` does not follow the keyboard — it stays the large viewport, 714.
 * Safari scrolls the document down by 337 instead, to bring the focused field
 * into what is left of the window. That scroll is what the finger can then
 * carry on moving, and the composer rides away with it.
 *
 * This has been shipped wrong twice, and both times for the same reason: the
 * page was made shorter without putting the scroll back. A 377px page still
 * scrolled to 337 leaves the window framing the space below it, which is the
 * blank screen that got reported. `scrollTo(0, 0)` is the missing half — and
 * with it there is no scroll left to pan, which is why nothing moves when you
 * drag afterwards.
 *
 * Only while the composer has focus, and only for a bite big enough to be a
 * keyboard, so a chat being read is never resized. Every browser that shrinks
 * its own viewport falls through to 100dvh and never sees this.
 */
export function useKeyboardFit(): { onFocus: () => void; onBlur: () => void } {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = document.documentElement;
    const clear = () => root.style.removeProperty('--sv-a-vh');

    if (!focused || !vv) {
      clear();
      return;
    }

    // Held at the top from the moment of focus, not from the moment the
    // keyboard's height is known.
    //
    // Safari scrolls to reveal the field the instant it is focused, and the
    // resize that tells us the keyboard's height arrives a few hundred
    // milliseconds later. Fitting on the resize alone therefore let the page
    // fly up and snap back -- which is what it looked like: the composer shot
    // up and then reattached. Pinning here means Safari's reveal never lands.
    const home = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    const fit = () => {
      // clientHeight is the layout viewport, which is the one Safari leaves
      // alone; innerHeight is not, once it has scrolled.
      const taken = Math.round(root.clientHeight - vv.height);
      if (taken < KEYBOARD_MIN) {
        clear();
        home();
        return;
      }
      root.style.setProperty('--sv-a-vh', `${Math.round(vv.height)}px`);
      // Shorten first, then go home: the other way round and Safari scrolls
      // back to reveal a field it still thinks is buried.
      home();
    };

    fit();
    window.addEventListener('scroll', home, { passive: true });
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      window.removeEventListener('scroll', home);
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      clear();
    };
  }, [focused]);

  return { onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}
