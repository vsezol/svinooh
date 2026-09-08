import { Logo } from '@svinooh/ui/Logo';

/**
 * What a new chat opens with.
 *
 * The mark, a name for the thing, and one line about what it is for. It used
 * to open with the portfolio — "Ask about Main portfolio" — and that was the
 * wrong frame twice over: it made the assistant look like a feature of a page,
 * and it is not true. The portfolio is one of the things it can read. It also
 * answers DeFi questions with no account at all, and it is growing towards
 * taking a task and coming back with a transaction for you to sign.
 *
 * Everything else that used to be here — a feature list, a caption about which
 * answers need a sign-in — is gone. A person opening a chat wants to type in
 * it, and the fastest way to explain an assistant is to let them ask it
 * something.
 */
export function AgentIntro() {
  return (
    <div className="sv-a-c-intro">
      <Logo mark size={20} />
      <h1 className="sv-a-c-intro-head">
        Your personal
        <br />
        crypto agent.
      </h1>
      <p className="sv-a-c-intro-sub">
        Ask anything in DeFi. Give it a task — it finds the move, you sign.
      </p>
    </div>
  );
}
