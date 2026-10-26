/**
 * What a new chat opens with.
 *
 * A name for the thing and one line about what it is for. No mark above it:
 * the wordmark is already in the header two rows up, and a second one floating
 * over an empty screen was decoration rather than orientation.
 *
 * Everything else that used to be here — a feature list, a caption about which
 * answers need a sign-in — is gone too. A person opening a chat wants to type
 * in it, and the fastest way to explain an assistant is to let them ask it
 * something.
 */
export function AgentIntro() {
  return (
    <div className="sv-a-c-intro">
      <h1 className="sv-a-c-intro-head">
        Your <span className="sv-a-c-intro-name">DeFi-Copilot</span>
      </h1>
      <p className="sv-a-c-intro-sub">
        Ask anything in DeFi. Give it a task — it finds the move, you sign.
      </p>
    </div>
  );
}
