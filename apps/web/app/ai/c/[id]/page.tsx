import type { Metadata } from 'next';
import { AgentPage } from '../../../../src/screens/AgentPage';

/**
 * One conversation, reopened.
 *
 * Reopenable rather than shareable: conversations live in the browser that had
 * them, so this is a link back to your own. noindex for the same reason a
 * portfolio is — there is nothing here for anybody else, and nobody arrives by
 * searching.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentPage conversationId={id} />;
}
