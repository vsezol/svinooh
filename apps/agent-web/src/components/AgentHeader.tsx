import './chrome.css';

interface Props {
  variant: 'embedded' | 'standalone';
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
export function AgentHeader({ variant, signedIn, onToggleTheme, onHistory, onNewChat, onSignIn }: Props) {
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

  return (
    <header className="sv-a-c-header" data-variant="standalone">
      <span className="sv-a-c-logo" aria-label="svinooh">
        <span>svin</span>
        <span className="sv-a-c-logo-eye" />
        <span className="sv-a-c-logo-eye" data-second="true" />
        <span className="sv-a-c-logo-h">h</span>
      </span>
      <span className="sv-a-c-agent-pill">Agent</span>
      <div className="sv-a-c-header-actions">
        {onToggleTheme ? (
          <button
            type="button"
            className="ui-icon-btn"
            data-variant="outline"
            data-size="sm"
            aria-label="Switch theme"
            onClick={onToggleTheme}
          >
            {/* Both icons render; CSS shows one off data-theme so the first paint agrees with the theme. */}
            <span className="sv-a-c-on-dark">{SUN}</span>
            <span className="sv-a-c-on-light">{MOON}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="ui-icon-btn sv-a-c-hide-desktop"
          data-variant="outline"
          data-size="sm"
          aria-label="History"
          onClick={onHistory}
        >
          {HISTORY}
        </button>
        <button type="button" className="ui-btn" data-variant="soft" data-size="sm" onClick={onNewChat}>
          New chat
        </button>
        {!signedIn ? (
          <button type="button" className="ui-btn" data-variant="accent" data-size="sm" onClick={onSignIn}>
            Sign in
          </button>
        ) : null}
      </div>
    </header>
  );
}
