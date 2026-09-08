'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from './Logo';

/**
 * The top of every signed-in screen, in one place.
 *
 * There used to be a header per surface — the portfolio drew its own row, the
 * agent drew another — and they drifted the way two copies of anything drift:
 * different heights, different logo sizes, a strip of tabs that only one of
 * them had. A person moving between them saw the page jump.
 *
 * It has two forms and folds between them. At rest it is two rows, 84px: the
 * wordmark with the account beside it, then the tabs. Once you are reading or
 * typing it becomes one row of 40px — the wordmark gives up everything but its
 * eyes, the tabs shrink a size and move up beside them. Which is 44 pixels
 * back, on a screen that only has 812, given to the thing you are actually
 * looking at.
 *
 * Desktop keeps the wordmark row and drops the tabs, because a rail is already
 * showing them; that is a stylesheet's decision (see .top-tabs) rather than a
 * second component.
 */

export interface AppTab {
  key: string;
  label: string;
}

export interface AppHeaderProps {
  tabs: readonly AppTab[];
  active: string;
  onTab: (key: string) => void;
  /** Beside the wordmark: the theme, the account — what belongs to the app. */
  brandActions?: ReactNode;
  /** At the end of the tab strip: what the OPEN tab offers, and nothing else. */
  tabActions?: ReactNode;
  /**
   * Fold it, whatever the page is doing.
   *
   * Left out, it folds once the window has been scrolled, which is the right
   * answer for a page. A screen whose scrolling happens inside it — a chat
   * transcript, say — knows better and says so.
   */
  collapsed?: boolean;
  onLogo?: () => void;
}

/**
 * How far down the page counts as reading rather than glancing.
 *
 * Small, because the fold is what the gesture is for: a header that waits for
 * half a screen has already cost you the half screen.
 */
const READING = 24;

export function AppHeader({
  tabs,
  active,
  onTab,
  brandActions,
  tabActions,
  collapsed,
  onLogo,
}: AppHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const uncontrolled = collapsed === undefined;

  useEffect(() => {
    if (!uncontrolled) return;
    const read = () => setScrolled(window.scrollY > READING);
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, [uncontrolled]);

  const folded = uncontrolled ? scrolled : collapsed;

  // A visitor has no pages to move between, so there is no strip and the
  // header is the wordmark row alone — not an empty 36px of nothing.
  const strip = tabs.length === 0 ? null : (
    <>
      <div className="top-tabs-list" data-folded={folded}>
        {folded ? <Logo mark size={20} onClick={onLogo} /> : null}
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="top-tab"
            data-active={tab.key === active}
            onClick={() => onTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabActions ? <div className="top-tab-actions">{tabActions}</div> : null}
    </>
  );

  return (
    <header className="app-header" data-folded={folded}>
      {/* Folded, the wordmark row is gone and its mark rides in the strip. */}
      {folded ? null : (
        <div className="app-brand">
          <Logo size={19} onClick={onLogo} />
          {brandActions ? <div className="app-brand-actions">{brandActions}</div> : null}
        </div>
      )}
      {strip ? <div className="top-tabs">{strip}</div> : null}
    </header>
  );
}
