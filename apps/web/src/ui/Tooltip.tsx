'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Kept clear of the viewport's edges */
const EDGE = 8;
/** Between the thing and what it says about itself */
const GAP = 6;

/**
 * A name or a sentence, on hover and on focus.
 *
 * Rendered into <body> rather than into the element it describes. In place it
 * was absolutely positioned inside its own trigger, which meant every ancestor
 * that clips got a vote: the pager clips sideways so the page next door cannot
 * show (`.pager-window`), wallet cards clip so their corners stay round, and a
 * tooltip near the right edge of either was simply cut in half. Two workarounds
 * had grown out of that — a whole `anchor="row"` mode for marks near the edge
 * of a phone, and a block in WalletRow that goes without `overflow: hidden` so
 * a chain marker's tooltip can escape its card. Both are gone: on <body> there
 * is nothing above it to clip it.
 *
 * Positioned from the trigger's own rectangle, flipped to the other side when
 * the preferred one has no room, and pulled back inside the viewport when
 * centring would hang it off an edge.
 *
 * The native `title` attribute was the app's answer in thirteen places and is
 * the wrong one: the browser waits about a second, draws it in the operating
 * system's type, and shows a finger nothing at all.
 */
export function Tooltip({
  text,
  label,
  size = 'sm',
  focusable,
  style,
  children,
}: {
  /** What it says. A string is the usual case; a node for anything with structure. */
  text: ReactNode;
  /** The accessible name, when `text` is not a plain string to borrow it from */
  label?: string;
  /**
   * `sm` is a name on one line, above the thing.
   * `lg` is a sentence that wraps, below it.
   */
  size?: 'sm' | 'lg';
  /**
   * Makes the trigger itself a tab stop.
   *
   * Off by default, and deliberately: most of these sit on a figure surrounded
   * by figures, and a tab stop on each would turn a table into a hundred of
   * them. On when there is nothing else to focus — the info mark exists only to
   * be hovered, so a keyboard has to be able to reach it.
   */
  focusable?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const w = pop.current?.offsetWidth ?? 0;
      const h = pop.current?.offsetHeight ?? 0;

      // A name sits above what it names, a sentence below the mark that opens
      // it — and either flips when its own side has no room left
      const above = a.top - GAP - h;
      const below = a.bottom + GAP;
      const top =
        size === 'lg'
          ? below + h > window.innerHeight - EDGE && above >= EDGE
            ? above
            : below
          : above < EDGE
            ? below
            : above;

      // Centred on the trigger, then pulled back inside the viewport rather
      // than being allowed to hang off it
      const centred = a.left + a.width / 2 - w / 2;
      const left = Math.min(Math.max(EDGE, centred), Math.max(EDGE, window.innerWidth - w - EDGE));
      setPos({ top, left });
    };
    place();
    // Measured again once it exists, so the flip knows its real height
    const raf = requestAnimationFrame(place);
    // It is anchored to something that moves when the page does
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, size, text]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span
      ref={anchor}
      className="ui-tip"
      tabIndex={focusable ? 0 : undefined}
      role="note"
      aria-label={label ?? (typeof text === 'string' ? text : undefined)}
      style={style}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open
        ? createPortal(
            <div
              ref={pop}
              className="ui-tip-pop"
              data-size={size === 'lg' ? 'lg' : undefined}
              aria-hidden
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                // Hidden for the frame it takes to measure, rather than shown
                // in the corner it was measured from
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/** The ringed italic i that opens a Tooltip — used where there is nothing else to hover. */
export function InfoTip({ text, label }: { text: ReactNode; label?: string }) {
  return (
    <Tooltip text={text} label={label ?? 'More about this setting'} size="lg" focusable>
      <span className="ui-tip-mark" aria-hidden>
        i
      </span>
    </Tooltip>
  );
}
