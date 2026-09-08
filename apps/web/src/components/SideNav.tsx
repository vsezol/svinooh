'use client';

import type { CSSProperties, ReactNode } from 'react';
import { AGENT_ENABLED } from '../lib/agent';

export type Tab = 'portfolio' | 'notifications' | 'agent' | 'admin';

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
  gap: collapsed ? 0 : 'var(--sp-4)',
  padding: collapsed ? '11px 0' : '10px 13px',
  borderRadius: 'var(--r-sm)',
  fontWeight: 'var(--fw-bold)',
  fontSize: 'var(--fs-body)',
  cursor: disabled ? 'default' : 'pointer',
  userSelect: 'none',
  color: active ? 'var(--acc-text)' : 'var(--mut)',
  background: active ? 'var(--acc-soft)' : 'transparent',
  opacity: disabled ? 0.55 : 1,
});

function SlidersIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ flexShrink: 0 }}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

interface Props {
  tab: Tab;
  onTab: (tab: Tab) => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  /** Only an admin is shown the admin rail entry — see MeDto.isAdmin */
  isAdmin: boolean;
}

/**
 * The owner's places — three of them once the agent is switched on, two until
 * then. See AGENT_ENABLED.
 *
 * The rail beside the page on a desktop. A phone gets tabs across the top
 * instead — see AppHeader in the kit — and the stylesheet picks between them, so
 * the server never has to guess which one the visitor is about to need.
 *
 * A visitor gets neither. There is one page for them — the portfolio the link
 * pointed at — and a rail listing somebody else's settings alongside it is a
 * door with nothing behind it.
 */
export function SideNav({ tab, onTab, collapsed, onCollapse, isAdmin }: Props) {
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
          gap: 'var(--sp-2)',
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
        <div
          {...(AGENT_ENABLED
            ? { className: 'nav-item', onClick: () => onTab('agent'), title: 'AI agent' }
            : { title: 'AI agent — soon' })}
          style={navItem(AGENT_ENABLED && tab === 'agent', !AGENT_ENABLED, collapsed)}
        >
          <SparkIcon size={16} />
          {label('AI agent')}
          {collapsed ? null : (
            <span
              className="mono"
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tr-tag)',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--r-full)',
                padding: '2px 7px',
              }}
            >
              {AGENT_ENABLED ? 'BETA' : 'SOON'}
            </span>
          )}
        </div>
        {isAdmin ? (
          <div
            className="nav-item"
            onClick={() => onTab('admin')}
            title="Admin"
            style={navItem(tab === 'admin', false, collapsed)}
          >
            <SlidersIcon size={16} />
            {label('Admin')}
          </div>
        ) : null}
        <div
          className="nav-collapse"
          onClick={() => onCollapse(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'var(--h-sm)',
            borderRadius: 'var(--r-sm)',
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
    </>
  );
}
