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

const navItem = (active: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 10,
  padding: '10px 13px',
  borderRadius: 10,
  fontWeight: 'var(--fw-bold)',
  // The strip's size, because this is the same list of pages said the other
  // way round — the phone reads it across the top, the desktop down the side.
  fontSize: 'var(--fs-nav)',
  cursor: disabled ? 'default' : 'pointer',
  userSelect: 'none',
  color: active ? 'var(--acc-text)' : 'var(--mut)',
  background: active ? 'var(--acc-soft)' : 'transparent',
  opacity: disabled ? 0.55 : 1,
});

function PlusIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ flexShrink: 0 }}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** How long ago, in as few words as say it. */
function ago(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

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
  /** Only an admin is shown the admin rail entry — see MeDto.isAdmin */
  isAdmin: boolean;
  /**
   * The chat, when it is the open tab: its conversations and the two things
   * you can do about them. Absent on every other tab.
   */
  chat?: {
    conversations: { id: string; title: string; at: number; active: boolean }[];
    onNew: () => void;
    onOpen: (id: string) => void;
  };
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
export function SideNav({ tab, onTab, isAdmin, chat }: Props) {
  const label = (text: string): ReactNode => <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;

  return (
    <>
      {/* desktop rail */}
      <div
        className="side-rail"
        style={{
          width: 232,
          flexShrink: 0,
          position: 'sticky',
          // Directly under the header, which is 56px and a hairline. It used to
          // clear a taller one and sit inside a padded shell; now it is against
          // the window's own edge and the rule down its side has to start where
          // the header's does.
          top: 'calc(var(--h-appbar) + env(safe-area-inset-top))',
          flexDirection: 'column',
          gap: 'var(--sp-2)',
        }}
      >
        {/* Same order as the strip, which is the same list of pages. They are
            two drawings of one navigation, and a reader moving between a phone
            and a desktop should not have to re-learn where things are. */}
        <div
          className="nav-item"
          onClick={() => onTab('portfolio')}
          title="Portfolio"
          style={navItem(tab === 'portfolio', false)}
        >
          <ChartIcon size={16} />
          {label('Portfolio')}
        </div>
        <div
          {...(AGENT_ENABLED
            ? { className: 'nav-item', onClick: () => onTab('agent'), title: 'AI agent' }
            : { title: 'AI agent — soon' })}
          style={navItem(AGENT_ENABLED && tab === 'agent', !AGENT_ENABLED)}
        >
          <SparkIcon size={16} />
          {label('AI agent')}
        </div>
        <div
          className="nav-item"
          onClick={() => onTab('notifications')}
          title="Alerts"
          style={navItem(tab === 'notifications', false)}
        >
          <BellIcon size={16} />
          {label('Alerts')}
        </div>
        {isAdmin ? (
          <div
            className="nav-item"
            onClick={() => onTab('admin')}
            title="Admin"
            style={navItem(tab === 'admin', false)}
          >
            <SlidersIcon size={16} />
            {label('Admin')}
          </div>
        ) : null}

        {/* The chat's own navigation, in the rail beside the pages — which is
            where the design puts it, and where it stops being two pills
            floating over a transcript. Only while the chat is the open tab:
            a New chat button on the alerts page is a button about somewhere
            else. */}
        {chat ? (
          <>
            <div className="rail-rule" />
            <button type="button" className="rail-new" onClick={chat.onNew}>
              <PlusIcon size={15} />
              New chat
            </button>
            {chat.conversations.length > 0 ? (
              <>
                <div className="rail-eyebrow mono">HISTORY</div>
                {chat.conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="rail-history ph-mask"
                    data-active={c.active}
                    onClick={() => chat.onOpen(c.id)}
                  >
                    <span className="rail-history-title">{c.title}</span>
                    <span className="rail-history-when mono">{ago(c.at)}</span>
                  </button>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
