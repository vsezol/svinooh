import type { Metadata } from 'next';
import { AgentPage } from '../../../../src/screens/AgentPage';

/**
 * One conversation, reopened.
 *
 * Kept by the agent service rather than by the browser that had it, so this
 * link opens the same conversation on a phone as on a laptop — which is what
 * makes it an address rather than a bookmark.
 *
 * Still not shareable, and that is a decision rather than a limitation: the
 * service answers 404 for an id that is not the caller's, because a chat names
 * positions and amounts and the privacy rule is that nothing identifying
 * somebody reaches anybody else by default. Sharing one is a decision to make
 * on the conversation later, not a link that happens to work. noindex for the
 * same reason a portfolio is — nobody arrives here by searching.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentPage conversationId={id} />;
}
