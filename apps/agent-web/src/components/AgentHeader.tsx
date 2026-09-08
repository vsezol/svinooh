// By its own path, not through the kit's barrel: the barrel re-exports
// ButtonLink, which imports next/link — a dependency this app does not have
// and does not need.
import { AppHeader } from '@svinooh/ui/AppHeader';

import './chrome.css';

/** The product's own address, which the other two tabs are pages of. */
const PRODUCT = 'https://svinooh.com';

const TABS = [
  { key: 'ai', label: 'AI' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'alerts', label: 'Alerts' },
];

interface Props {
  variant: 'embedded' | 'standalone';
  /** True once the transcript has been scrolled — see AppHeader. */
  collapsed?: boolean;
  signedIn: boolean;
  onToggleTheme?: () => void;
  onHistory: () => void;
  onNewChat: () => void;
  onSignIn: () => void;
}

const SUN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MOON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </svg>
);

const PLUS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const ACCOUNT = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const HISTORY = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 3.5v5h5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/**
 * The top chrome of the chat. Standalone owns the whole page top (logo, theme,
 * sign-in); embedded contributes only the New chat / History button pair to a
 * bar the host App composes (the App renders the GroundingChip beside it).
 */
export function AgentHeader({
  variant,
  collapsed,
  signedIn,
  onToggleTheme,
  onHistory,
  onNewChat,
  onSignIn,
}: Props) {
  if (variant === 'embedded') {
    return (
      <header className="sv-a-c-header" data-variant="embedded">
        <button type="button" className="ui-btn" data-variant="soft" data-size="xs" onClick={onNewChat}>
          New chat
        </button>
        <button type="button" className="ui-btn" data-variant="soft" data-size="xs" onClick={onHistory}>
          History
        </button>
      </header>
    );
  }

  // Standalone is the same app at another address, so it wears the same
  // header the portfolio does: the kit's, with the same tabs, the same fold,
  // the same everything. The other two tabs are pages on the product's own
  // domain; this one is here.
  return (
    <AppHeader
      tabs={TABS}
      active="ai"
      collapsed={collapsed}
      onTab={(key) => {
        if (key !== 'ai') window.location.assign(`${PRODUCT}/${key === 'portfolio' ? '' : 'alerts'}`);
      }}
      onLogo={() => window.location.assign(PRODUCT)}
      brandActions={
        <>
          {onToggleTheme ? (
            <button
              type="button"
              className="ui-icon-btn"
              data-variant="outline"
              data-size="sm"
              aria-label="Switch theme"
              onClick={onToggleTheme}
            >
              {/* Both render; CSS shows one off data-theme so the first paint
                  agrees with the theme rather than correcting itself. */}
              <span className="sv-a-c-on-dark">{SUN}</span>
              <span className="sv-a-c-on-light">{MOON}</span>
            </button>
          ) : null}
          {signedIn ? (
            <span className="sv-a-c-account" aria-hidden="true">
              {ACCOUNT}
            </span>
          ) : (
            <button type="button" className="ui-btn" data-variant="accent" data-size="sm" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </>
      }
      tabActions={
        <>
          <button type="button" className="sv-a-c-tab-action" aria-label="New chat" onClick={onNewChat}>
            {PLUS}
          </button>
          <button type="button" className="sv-a-c-tab-action" aria-label="History" onClick={onHistory}>
            {HISTORY}
          </button>
        </>
      }
    />
  );
}
