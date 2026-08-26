import { useEffect, useRef, useState } from 'react';
import { fmtUsd } from '../lib/format';

const TWEEN_MS = 700;
const FLASH_MS = 900;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * A dollar figure that counts to its new value instead of jumping, and flashes
 * green or red on the way. Reads as a number moving rather than a number
 * replaced — which is what makes a balance feel live.
 *
 * Honours prefers-reduced-motion: the value still updates, it just arrives.
 */
export function AnimatedUsd({
  value,
  style,
  className,
}: {
  value: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const from = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;

    setFlash(value > start ? 'up' : 'down');
    const flashTimer = setTimeout(() => setFlash(null), FLASH_MS);

    const settle = () => {
      cancelAnimationFrame(frame.current);
      from.current = value;
      setShown(value);
    };

    // Nothing to animate into: a hidden tab freezes requestAnimationFrame, and
    // a stuck tween would leave the old figure on screen for whenever the
    // visitor comes back.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || document.hidden) {
      settle();
      return () => clearTimeout(flashTimer);
    }

    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / TWEEN_MS);
      setShown(start + (value - start) * easeOut(t));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(step);
    // Backstop for a throttled tab: if the frames never arrive, land on the number anyway
    const guard = setTimeout(settle, TWEEN_MS + 250);

    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(flashTimer);
      clearTimeout(guard);
      from.current = value;
    };
  }, [value]);

  return (
    <span
      className={className}
      style={{
        ...style,
        color: flash === 'up' ? 'var(--up)' : flash === 'down' ? 'var(--down)' : style?.color,
        transition: 'color 0.5s ease',
        // Digits of equal width, so the figure doesn't jitter as it counts
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {fmtUsd(shown)}
    </span>
  );
}
