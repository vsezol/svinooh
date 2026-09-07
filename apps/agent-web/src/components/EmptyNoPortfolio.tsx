// Shortened the way the chat renders real ones - these are format examples,
// not tappable addresses.
const EXAMPLES = ['0x7bfee9…c060', '9xQeWv…3nMk', 'bc1qar0s…5mdq'];

/** Signed in, nothing tracked yet: invites pasting addresses into the composer. */
export function EmptyNoPortfolio() {
  return (
    <div className="sv-a-c-empty">
      <h2 className="sv-a-c-empty-title">No portfolio yet.</h2>
      <p className="sv-a-c-empty-copy">
        Paste one or more wallet addresses — EVM, Solana, TRON or Bitcoin — and I'll set it up right here.
      </p>
      <div className="sv-a-c-pills">
        {EXAMPLES.map((a) => (
          <span key={a} className="sv-a-c-pill">
            {a}
          </span>
        ))}
      </div>
      <div className="sv-a-c-eyebrow">One per line or comma-separated</div>
    </div>
  );
}
