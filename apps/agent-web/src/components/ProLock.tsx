/**
 * Replaces the composer when the host says the agent is Pro-gated; the log
 * above stays readable. Checkout lives on svinooh.com, so the CTA is a plain
 * link, not an in-app flow.
 */
export function ProLock() {
  return (
    <div className="sv-a-c-prolock">
      <div className="sv-a-c-eyebrow">Pro feature</div>
      <div className="sv-a-c-prolock-card">
        <div className="sv-a-c-prolock-title">The agent is a Pro feature.</div>
        <p className="sv-a-c-prolock-sub">
          Ask anything about your wallets — positions, yields, health factors, what moved today.
        </p>
        <a className="ui-btn" data-variant="accent" data-size="lg" href="https://svinooh.com/pro">
          Go Pro — $5 today
        </a>
        <div className="sv-a-c-eyebrow">Then $10 / month · Crypto · No auto-renew</div>
      </div>
      <div className="sv-a-c-prolock-caption">Pro unlocks the agent</div>
    </div>
  );
}
