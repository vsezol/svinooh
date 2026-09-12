import { useEffect, useRef, useState } from 'react';
import { AnchoredMenu, IconButton, Switch } from '../ui';

/**
 * Two rows and a knob on each — the shape everything else in the interface
 * uses for "options", rather than a gear that turns to mud at 15 pixels.
 */
const SLIDERS = (
  <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.4}>
    <path d="M2 5.2h9M13.2 5.2H14M2 10.8h3.2M7.4 10.8H14" strokeLinecap="round" />
    <circle cx="12.1" cy="5.2" r="1.6" />
    <circle cx="6.3" cy="10.8" r="1.6" />
  </svg>
);

const KEY = 'sv.chart.syncCursor';
const WIDTH = 284; // enough for the switch's name on one line

/**
 * Whether the charts on this page read the same instant, remembered per browser.
 *
 * Storage rather than the account: it is how somebody reads a chart, not
 * something about their portfolio, and the page is open to people who have no
 * account at all. Read on the client, because storage does not exist while the
 * page is being prepared — until then it is on, which is what a first visit
 * should get.
 */
export function useSyncCursor(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);

  useEffect(() => {
    try {
      setOn(localStorage.getItem(KEY) !== '0');
    } catch {
      // A browser that refuses storage still gets the charts, just a forgetful page
    }
  }, []);

  return [
    on,
    (next: boolean) => {
      setOn(next);
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // as above
      }
    },
  ];
}

/**
 * How the charts behave, beside the periods that decide what they show.
 *
 * One switch today. It is behind a button rather than on the page because the
 * row it sits in is the one that answers "what am I looking at" — a period and
 * a scope — and a preference about reading is not that question.
 */
export function ChartSettings({
  syncCursor,
  onSyncCursor,
}: {
  syncCursor: boolean;
  onSyncCursor: (on: boolean) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ flexShrink: 0 }}>
      <IconButton
        ref={button}
        variant="outline"
        size="sm"
        label="Chart settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {SLIDERS}
      </IconButton>

      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchor={button}
        width={WIDTH}
        label="Chart settings"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' }}>
              Sync cursor across charts
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)', marginTop: 3, lineHeight: 1.5 }}>
              Point at a moment on one chart and read it on all of them
            </div>
          </div>
          <Switch on={syncCursor} onChange={onSyncCursor} label="Sync cursor across charts" />
        </div>
      </AnchoredMenu>
    </div>
  );
}
