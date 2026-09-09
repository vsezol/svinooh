'use client';

import { useEffect, useState } from 'react';

/**
 * Milliseconds since this page started moving, read off the wall clock.
 *
 * Every animation on the landing is a function of this one number rather than
 * a count of ticks, which is the difference between an animation and a
 * stopwatch. A background tab has its timers throttled to once a second or
 * worse; a trace driven by tick counts stalls there and comes back mid-step,
 * while one driven by the clock comes back exactly where the clock says it
 * should be.
 *
 * Zero until an effect starts it, because the server renders this page and the
 * browser has to agree with what the server drew. `Date.now()` during the
 * first render is two different numbers on the two sides of that handover.
 *
 * The interval stops while the tab is hidden and starts again on the way back,
 * and nothing is lost by that: the clock is elapsed time, not accumulated
 * frames, so the first frame after returning is the frame that belongs to now.
 *
 * `null` means somebody has asked their system for less movement. Every caller
 * answers that for itself by substituting the value of `t` at which its own
 * animation is at rest — a full bar and a finished sentence, rather than a
 * frozen half-drawn one.
 */
export function useWallClock(): number | null {
  const [t, setT] = useState<number | null>(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setT(null);
      return;
    }
    const start = Date.now();
    let id = 0;
    const run = () => {
      window.clearInterval(id);
      // 40ms: the trace ticks in tenths of a second and the caret blinks on a
      // step function, so nothing here reads faster than 25 frames.
      id = window.setInterval(() => setT(Date.now() - start), 40);
    };
    const idle = () => window.clearInterval(id);
    const visibility = () => (document.hidden ? idle() : run());
    run();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  return t;
}
