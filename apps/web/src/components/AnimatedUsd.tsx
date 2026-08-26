import { useEffect, useRef, useState } from 'react';
import { fmtUsd } from '../lib/format';

interface Frame {
  text: string;
  /** Per character: is this one different from what was on screen a moment ago */
  changed: boolean[];
  dir: 'up' | 'down';
  /** Bumped on every change, so a character that moves twice animates twice */
  seq: number;
}

/**
 * A dollar figure that animates only the characters that actually changed —
 * the cents tick over while the millions sit still.
 *
 * Moving the whole number on every update says "all of this is different",
 * which is both untrue and hard to read. Moving one digit says exactly what
 * changed, and the rest of the figure stays legible while it happens.
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
  const [frame, setFrame] = useState<Frame>(() => ({ text: fmtUsd(value), changed: [], dir: 'up', seq: 0 }));
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    const before = fmtUsd(prev.current);
    const after = fmtUsd(value);
    const dir: 'up' | 'down' = value >= prev.current ? 'up' : 'down';
    prev.current = value;
    // A move too small to print ($0.004) leaves the figure exactly as it was
    if (before === after) return;
    // A different length means every character shifted along, so none of them
    // can be compared where it stands — the whole figure is new.
    const alignable = before.length === after.length;
    const changed = [...after].map((ch, i) => !alignable || before[i] !== ch);
    setFrame((f) => ({ text: after, changed, dir, seq: f.seq + 1 }));
  }, [value]);

  return (
    <span
      className={className}
      // Digits of equal width, so a character landing never nudges its neighbours
      style={{ ...style, fontVariantNumeric: 'tabular-nums' }}
    >
      {[...frame.text].map((ch, i) =>
        frame.changed[i] ? (
          // Keyed by the frame it belongs to: a new key remounts the character,
          // which is what replays the animation
          <span key={`${frame.seq}.${i}`} className={frame.dir === 'up' ? 'digit-up' : 'digit-down'}>
            {ch}
          </span>
        ) : (
          <span key={`still.${i}`}>{ch}</span>
        ),
      )}
    </span>
  );
}
