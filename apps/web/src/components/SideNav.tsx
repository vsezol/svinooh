'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { relativeDay } from '@svinooh/ui/when';
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

const NARROW_KEY = 'svinooh_rail_narrow';

const navItem = (active: boolean, disabled: boolean, narrow = false): CSSProperties => ({
  // A button's own furniture, undone: these were divs with a click handler,
  // which meant the rail — the main navigation of every signed-in screen —
  // could not be reached by a keyboard at all, and so could never show the
  // focus ring the rest of the product now has.
  border: 'none',
  width: '100%',
  fontFamily: 'inherit',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  justifyContent: narrow ? 'center' : 'flex-start',
  gap: 10,
  padding: narrow ? '10px 0' : '10px 13px',
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

function ChevronsIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
    </svg>
  );
}

function PlusIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ flexShrink: 0 }}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
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
 * then, and the agent first. See AGENT_ENABLED and tabsFor.
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
  const [narrow, setNarrow] = useState(false);

  // Read on the client, because the choice lives in storage and storage does
  // not exist while the page is being prepared. Until then the rail is open,
  // which is the state a first visit should get.
  useEffect(() => {
    try {
      setNarrow(localStorage.getItem(NARROW_KEY) === '1');
    } catch {
      // A browser that refuses storage still gets a working rail, just a
      // forgetful one.
    }
  }, []);

  const toggle = () => {
    setNarrow((was) => {
      try {
        localStorage.setItem(NARROW_KEY, was ? '0' : '1');
      } catch {
        // as above
      }
      return !was;
    });
  };

  // Narrow, the label goes and the icon's own tooltip carries the name — which
  // is why every row sets `title` whether or not it is showing one.
  const label = (text: string): ReactNode =>
    narrow ? null : <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;

  return (
    <>
      {/* desktop rail */}
      <div
        className="side-rail"
        data-narrow={narrow}
        style={{
          width: narrow ? 68 : 232,
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
        {/* Same order as the strip, which is the same list of pages — see
            tabsFor, where that order is decided. They are two drawings of one
            navigation, and a reader moving between a phone and a desktop
            should not have to re-learn where things are. */}
        <button
          type="button"
          className="nav-item"
          disabled={!AGENT_ENABLED}
          onClick={() => onTab('agent')}
          title={AGENT_ENABLED ? 'AI agent' : 'AI agent — soon'}
          aria-current={AGENT_ENABLED && tab === 'agent' ? 'page' : undefined}
          style={navItem(AGENT_ENABLED && tab === 'agent', !AGENT_ENABLED, narrow)}
        >
          <SparkIcon size={16} />
          {label('AI agent')}
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => onTab('portfolio')}
          title="Portfolio"
          aria-current={tab === 'portfolio' ? 'page' : undefined}
          style={navItem(tab === 'portfolio', false, narrow)}
        >
          <ChartIcon size={16} />
          {label('Portfolio')}
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => onTab('notifications')}
          title="Alerts"
          aria-current={tab === 'notifications' ? 'page' : undefined}
          style={navItem(tab === 'notifications', false, narrow)}
        >
          <BellIcon size={16} />
          {label('Alerts')}
        </button>
        {isAdmin ? (
          <button
            type="button"
            className="nav-item"
            onClick={() => onTab('admin')}
            title="Admin"
            aria-current={tab === 'admin' ? 'page' : undefined}
            style={navItem(tab === 'admin', false, narrow)}
          >
            <SlidersIcon size={16} />
            {label('Admin')}
          </button>
        ) : null}

        {/* The chat's own navigation, in the rail beside the pages — which is
            where the design puts it, and where it stops being two pills
            floating over a transcript. Only while the chat is the open tab:
            a New chat button on the alerts page is a button about somewhere
            else. */}
        {chat ? (
          <>
            <div className="rail-rule" />
            <button type="button" className="rail-new" onClick={chat.onNew} title="New chat">
              <PlusIcon size={15} />
              {label('New chat')}
            </button>
            {/* Narrow, the list has no width to say anything with: a column of
                clipped first words is not a list of conversations. The rail
                keeps the one action that still reads at icon size. */}
            {!narrow && chat.conversations.length > 0 ? (
              <>
                <div className="rail-eyebrow mono">HISTORY</div>
                {/* The list is the only part of the rail that grows without
                    limit, so it is the only part that scrolls. The pages above
                    it stay reachable — and on this tab the page behind the
                    rail does not scroll at all, so without this a long history
                    simply ran off the bottom of the screen. */}
                <div className="rail-history-list">
                  {chat.conversations.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="rail-history ph-mask"
                      data-active={c.active}
                      onClick={() => chat.onOpen(c.id)}
                    >
                      <span className="rail-history-title">{c.title}</span>
                      <span className="rail-history-when mono">{relativeDay(c.at)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* Pushed to the bottom of the rail, and the last thing in it: the
            rail is a list of places, and this is not one of them. */}
        <button
          type="button"
          className="rail-fold"
          onClick={toggle}
          title={narrow ? 'Widen the sidebar' : 'Narrow the sidebar'}
          aria-label={narrow ? 'Widen the sidebar' : 'Narrow the sidebar'}
          aria-expanded={!narrow}
        >
          <ChevronsIcon size={16} />
        </button>
      </div>
    </>
  );
}
