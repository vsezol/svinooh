interface Props {
  onSignIn: (provider: 'telegram' | 'x') => void;
}

const ICON_READ = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ICON_EXPLAIN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6l7-3z" />
  </svg>
);

const ICON_CREATE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);

const FEATURES = [
  { icon: ICON_READ, text: 'Reads every wallet, pool and loan you track' },
  { icon: ICON_EXPLAIN, text: 'Explains health factor, ranges and borrow rates' },
  { icon: ICON_CREATE, text: 'Creates a portfolio from addresses you paste' },
];

/**
 * The signed-out standalone empty state. The composer stays enabled below it
 * (general DeFi questions work anonymously); the App renders it separately.
 */
export function Door({ onSignIn }: Props) {
  return (
    <div className="sv-a-c-door">
      <h1 className="sv-a-c-door-head">Ask anything about your wallets.</h1>
      <p className="sv-a-c-door-sub">
        Positions, yields, health factors — explained. Portfolio answers need a sign-in; general DeFi questions
        don't.
      </p>
      <div className="sv-a-c-door-features">
        {FEATURES.map((f) => (
          <div key={f.text} className="sv-a-c-door-feature">
            <span className="sv-a-c-door-icon">{f.icon}</span>
            {f.text}
          </div>
        ))}
      </div>
      <div className="sv-a-c-door-ctas">
        <button type="button" className="ui-btn" data-variant="accent" data-size="lg" data-block="true" onClick={() => onSignIn('telegram')}>
          Continue with Telegram
        </button>
        <button type="button" className="ui-btn" data-variant="soft" data-size="lg" data-block="true" onClick={() => onSignIn('x')}>
          Continue with X
        </button>
      </div>
    </div>
  );
}
