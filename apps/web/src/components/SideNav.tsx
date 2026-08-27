'use client';

import type { CSSProperties, ReactNode } from 'react';

export type Tab = 'portfolio' | 'notifications';

/** The dock's pill slides between fixed slots, so both have to be one number */
const DOCK_W = 72;
const DOCK_H = 42;

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
  width: DOCK_W,
  height: DOCK_H,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  cursor: disabled ? 'default' : 'pointer',
  userSelect: 'none',
  color: active ? 'var(--acc-ink)' : 'var(--mut)',
  opacity: disabled ? 0.45 : 1,
  transition: 'color 0.26s ease',
});

const DOCK_LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.01em' };

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

      {/* phone dock */}
      <div
        className="tab-dock"
        // Placement lives in the stylesheet — see .tab-dock. It needs a
        // dynamic-viewport unit to follow the bottom of an iOS screen, and a
        // media query to tell a browser toolbar from a home indicator.
        style={{
          position: 'fixed',
          zIndex: 60,
          background: 'color-mix(in srgb, var(--surf) 86%, transparent)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--line2)',
          borderRadius: 16,
          padding: 3,
          boxShadow: '0 14px 30px -16px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ position: 'relative', display: 'flex' }}>
          {/* The pill is one element that moves, not a background that appears
              under whichever tab is on — so the selection travels the distance */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: DOCK_W,
              height: DOCK_H,
              borderRadius: 13,
              background: 'var(--acc)',
              transform: `translateX(${tab === 'notifications' ? DOCK_W : 0}px)`,
              transition: 'transform 0.46s cubic-bezier(0.34,1.42,0.5,1)',
              zIndex: 0,
            }}
          />
          <div onClick={() => onTab('portfolio')} style={dockItem(tab === 'portfolio', false)}>
            <ChartIcon size={19} />
            <span style={DOCK_LABEL}>Portfolio</span>
          </div>
          <div onClick={() => onTab('notifications')} style={dockItem(tab === 'notifications', false)}>
            <BellIcon size={19} />
            <span style={DOCK_LABEL}>Alerts</span>
          </div>
          <div title="AI agent — soon" style={dockItem(false, true)}>
            <SparkIcon size={19} />
            <span style={DOCK_LABEL}>AI agent</span>
          </div>
        </div>
      </div>
    </>
  );
}
