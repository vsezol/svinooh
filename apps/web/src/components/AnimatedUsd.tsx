import { useEffect, useRef, useState } from 'react';
import { fmtUsd } from '../lib/format';

/** Long enough to read as motion, short enough to land before the next change */
const ROLL_MS = 620;
/** Each place starts a little after the one to its right, the way a geared dial does */
const STAGGER_MS = 26;
const MAX_STAGGER_MS = 110;

interface Frame {
  text: string;
  /** What stood in each slot a moment ago — null once the roll has landed */
  from: string | null;
  /** Where the figure went, which is where every moving slot goes */
  up: boolean;
  /** Bumped on every change, so a slot that moves twice animates twice */
  seq: number;
}

/**
 * A dollar figure that rolls over, the way a counter does.
 *
 * Only the characters that actually changed move: the cents turn over while the
 * millions sit still. The one that moves leaves in the direction the figure
 * went and its replacement arrives from the other side — rising, digits come up
 * from below; falling, they come down from above.
 *
 * That direction is the whole figure's, not each digit's. A dial is geared:
 * when the number climbs, every wheel that turns climbs with it, including the
 * one going 9 → 0. Compared digit by digit that nine reads as a fall, and
 * letting it drop while its neighbours rise is how one number stops looking
 * like one number.
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
  const [frame, setFrame] = useState<Frame>(() => ({
    text: fmtUsd(value),
    from: null,
    up: true,
    seq: 0,
  }));
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    const before = fmtUsd(previous.current);
    const after = fmtUsd(value);
    const up = value > previous.current;
    previous.current = value;
    // A move too small to print ($0.004) leaves the figure exactly as it was
    if (before === after) return;

    setFrame((f) => ({ text: after, from: before, up, seq: f.seq + 1 }));
    // Once it has landed, the outgoing characters leave the page. While they are
    // in it the figure reads as two numbers at once to anything that takes its
    // text — a screen reader, a copy.
    const landed = setTimeout(
      () => setFrame((f) => (f.text === after ? { ...f, from: null } : f)),
      ROLL_MS + MAX_STAGGER_MS,
    );
    return () => clearTimeout(landed);
  }, [value]);

  const { text, from, up, seq } = frame;
  // A different length means every slot shifted along, so none of them can be
  // compared where it stands and the figure simply appears
  const comparable = from !== null && from.length === text.length ? from : null;

  return (
    <span
      className={className}
      // Digits of equal width, so nothing nudges its neighbours as it turns over
      style={{ ...style, fontVariantNumeric: 'tabular-nums' }}
    >
      {[...text].map((ch, i) => {
        const was = comparable?.[i];
        if (was === undefined || was === ch) return <span key={`still.${i}`}>{ch}</span>;
        // The rightmost place to move goes first and the rest follow it
        const delay = { animationDelay: `${Math.min((text.length - 1 - i) * STAGGER_MS, MAX_STAGGER_MS)}ms` };
        return (
          <span key={`${seq}.${i}`} className="roll">
            <span className={up ? 'roll-out-up' : 'roll-out-down'} style={delay} aria-hidden="true">
              {was}
            </span>
            <span className={up ? 'roll-in-up' : 'roll-in-down'} style={delay}>
              {ch}
            </span>
          </span>
        );
      })}
    </span>
  );
}
