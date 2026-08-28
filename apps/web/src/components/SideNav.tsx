'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export type Tab = 'portfolio' | 'notifications';

/**
 * Keeps the bar's bottom edge on the bottom edge of what is actually visible.
 *
 * Neither CSS length can find that edge on iOS. `bottom` measures from the
 * layout viewport, which keeps the height the page had while Safari's toolbar
 * was expanded; `100dvh` is meant to be the viewport as it is now, but Safari
 * does not re-resolve it when the toolbar collapses under a scroll — measured
 * on an iPhone mid-scroll it still read 714 while 754 was on screen, which is
 * 40px of dead air under the bar.
 *
 * visualViewport is the one thing that answers honestly, and it fires when the
 * toolbar moves. There is no gap to keep: the bar meets that edge the way a
 * tab bar does, and the home indicator is held off by its own padding rather
 * than by floating the whole bar above it.
 */
function useDockToVisibleBottom(): React.RefObject<HTMLDivElement | null> {
  const dock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dock.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    let queued = false;
    const place = () => {
      queued = false;
      // The bar hangs upwards from this line — see .tab-dock's transform
      el.style.top = `${vv.offsetTop + vv.height}px`;
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(place);
    };

    place();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    // The toolbar collapses under a scroll, and Safari has been known to settle
    // the viewport without saying so
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('orientationchange', schedule);
    };
  }, []);

  return dock;
}

/** The three slots divide the width, so the sliding pill travels in percent */
const DOCK_SLOTS = 3;

const ICON = {
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
  stroke: 'currentColor',
} as const;

function ChartIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ flexShrink: 0 }}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M21 7v5h-5" />
    </svg>
  );
}

function BellIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ flexShrink: 0 }}>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </svg>
  );
}

function SparkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ flexShrink: 0 }}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    </svg>
  );
}

const navItem = (active: boolean, disabled: boolean, collapsed: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: collapsed ? 'center' : 'flex-start',
  gap: collapsed ? 0 : 10,
  padding: collapsed ? '11px 0' : '10px 13px',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 13.5,
  cursor: disabled ? 'default' : 'pointer',
  userSelect: 'none',
  color: active ? 'var(--acc-text)' : 'var(--mut)',
  background: active ? 'var(--acc-soft)' : 'transparent',
  opacity: disabled ? 0.55 : 1,
});

const dockItem = (active: boolean, disabled: boolean): CSSProperties => ({
  position: 'relative',
  zIndex: 1,
  // Equal thirds of the width — a tab bar's slots are the width, divided
  flex: 1,
  minWidth: 0,
  height: 50,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  cursor: disabled ? 'default' : 'pointer',
  userSelect: 'none',
  color: active ? 'var(--acc-text)' : 'var(--mut)',
  opacity: disabled ? 0.45 : 1,
  transition: 'color 0.26s ease',
});

/** The icon sits in this, so the pill behind it has something to be the size of */
const DOCK_ICON_BOX: CSSProperties = {
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const DOCK_LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.01em' };

interface Props {
  tab: Tab;
  onTab: (tab: Tab) => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

/**
 * The owner's two places, and the one that isn't ready.
 *
 * Both shapes are rendered and the stylesheet picks: `.side-rail` on a desktop,
 * `.tab-dock` on a phone. Measuring the window in JS instead would mean the
 * server rendering one of them blind and the browser correcting it, which is a
 * flash of the wrong navigation on every load.
 *
 * A visitor gets neither. There is one page for them — the portfolio the link
 * pointed at — and a rail listing somebody else's settings alongside it is a
 * door with nothing behind it.
 */
export function SideNav({ tab, onTab, collapsed, onCollapse }: Props) {
  const dock = useDockToVisibleBottom();
  const label = (text: string): ReactNode =>
    collapsed ? null : <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;

  return (
    <>
      {/* desktop rail */}
      <div
        className="side-rail"
        style={{
          width: collapsed ? 46 : 188,
          flexShrink: 0,
          position: 'sticky',
          top: 78,
          flexDirection: 'column',
          gap: 4,
          transition: 'width 0.2s ease',
        }}
      >
        <div
          className="nav-item"
          onClick={() => onTab('portfolio')}
          title="Portfolio"
          style={navItem(tab === 'portfolio', false, collapsed)}
        >
          <ChartIcon size={16} />
          {label('Portfolio')}
        </div>
        <div
          className="nav-item"
          onClick={() => onTab('notifications')}
          title="Notifications"
          style={navItem(tab === 'notifications', false, collapsed)}
        >
          <BellIcon size={16} />
          {label('Notifications')}
        </div>
        <div title="AI agent — soon" style={navItem(false, true, collapsed)}>
          <SparkIcon size={16} />
          {label('AI agent')}
          {collapsed ? null : (
            <span
              className="mono"
              style={{
                marginLeft: 'auto',
                fontSize: 8.5,
                letterSpacing: '0.1em',
                border: '1px solid var(--line2)',
                borderRadius: 999,
                padding: '2px 7px',
              }}
            >
              SOON
            </span>
          )}
        </div>
        <div
          className="nav-collapse"
          onClick={() => onCollapse(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 34,
            borderRadius: 10,
            border: '1px solid var(--line)',
            color: 'var(--mut)',
            cursor: 'pointer',
            userSelect: 'none',
            marginTop: 6,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            {...ICON}
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
          >
            <path d="M11 17l-5-5 5-5" />
            <path d="M18 17l-5-5 5-5" />
          </svg>
        </div>
      </div>

      {/* phone tab bar — where the bottom of the screen is gets measured, not
          declared: see useDockToVisibleBottom. The stylesheet holds the look
          and the opening guess at `top`, for the frame before the first
          measurement lands. */}
      <div ref={dock} className="tab-dock">
        <div style={{ position: 'relative', display: 'flex' }}>
          {/* The pill is one element that moves, not a background that appears
              under whichever tab is on — so the selection travels the distance.
              It rides a third-of-the-width carrier, which is how it can slide
              between slots whose size only the browser knows. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${100 / DOCK_SLOTS}%`,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `translateX(${tab === 'notifications' ? 100 : 0}%)`,
              transition: 'transform 0.46s cubic-bezier(0.34,1.42,0.5,1)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          >
            <div style={{ width: 54, height: 26, borderRadius: 13, background: 'var(--acc-soft)' }} />
          </div>
          <div onClick={() => onTab('portfolio')} style={dockItem(tab === 'portfolio', false)}>
            <div style={DOCK_ICON_BOX}>
              <ChartIcon size={20} />
            </div>
            <span style={DOCK_LABEL}>Portfolio</span>
          </div>
          <div onClick={() => onTab('notifications')} style={dockItem(tab === 'notifications', false)}>
            <div style={DOCK_ICON_BOX}>
              <BellIcon size={20} />
            </div>
            <span style={DOCK_LABEL}>Alerts</span>
          </div>
          <div title="AI agent — soon" style={dockItem(false, true)}>
            <div style={DOCK_ICON_BOX}>
              <SparkIcon size={20} />
            </div>
            <span style={DOCK_LABEL}>AI agent</span>
          </div>
        </div>
      </div>
    </>
  );
}
