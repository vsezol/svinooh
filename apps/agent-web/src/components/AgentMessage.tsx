import type { ReactNode } from 'react';

const RING = (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <circle cx="4" cy="4" r="3" />
  </svg>
);

/**
 * An agent turn: no bubble, a bare left-aligned stack of blocks under a small
 * identity row. Children are the rendered blocks; this component knows nothing
 * about their kinds.
 */
export function AgentMessage({ children }: { children: ReactNode }) {
  return (
    <div className="sv-a-c-msg">
      <div className="sv-a-c-msg-head">
        <span className="sv-a-c-msg-avatar">{RING}</span>
        <span className="sv-a-c-msg-name">agent</span>
      </div>
      {children}
    </div>
  );
}
