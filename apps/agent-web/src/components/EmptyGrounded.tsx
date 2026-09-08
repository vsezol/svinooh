import { AgentIntro } from './AgentIntro';

/**
 * The empty log of a signed-in chat.
 *
 * The same opening as everybody else's. It used to name the portfolio and read
 * out its wallet count and total — a header, a subtitle and a figure, before a
 * word had been typed, restating what the portfolio tab already shows and
 * framing the assistant as a thing that talks about one page.
 *
 * The openers moved out of here and up against the composer, where the design
 * puts them: they are the fastest way to start typing, and they belong next to
 * the place you type.
 */
export function EmptyGrounded() {
  return <AgentIntro />;
}
