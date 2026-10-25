import type { ReactNode } from 'react';

/**
 * An agent turn: a bare left-aligned stack of blocks, and nothing else.
 *
 * No bubble, no avatar, no name. There used to be a small "○ agent" row over
 * every answer, which on a phone cost a line of vertical room and a slice of
 * width to say the one thing the reader already knew — the other side of the
 * conversation is the only side that gets a bubble, so anything without one is
 * the agent by construction.
 *
 * What that buys is the full column for the answer, which is the whole point:
 * this is a reading surface before it is a chat.
 */
export function AgentMessage({ children }: { children: ReactNode }) {
  return <div className="sv-a-c-msg">{children}</div>;
}
