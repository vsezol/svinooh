import { api } from './api';
import type { AgentBlock, Answerer } from './agent';

/**
 * Answers by asking the agent service through the gateway, rather than computing
 * in the browser (the `localAnswerer` stand-in). This is the `Answerer` the
 * design was waiting on — "a request to the agent service later".
 *
 * A factory rather than a bare function, because an answer has a place and a
 * thread: the slug tells the agent which portfolio to ground its numbers in
 * (the user's own token rides on the request via `api`), and the session id the
 * service returns is carried into the next question, so "as we discussed"
 * works across turns. Both live here, behind the seam — AgentChat still just
 * calls answer(question).
 *
 * Today the service returns one paragraph, so an answer is a single text block.
 * As it grows to return the richer blocks the vocabulary already allows (stats,
 * charts, tables), only this file changes.
 */
export function serviceAnswerer(portfolioSlug: string): Answerer {
  let sessionId: string | undefined;
  return async (question): Promise<AgentBlock[]> => {
    const { reply, session_id } = await api<{ reply: string; session_id?: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: question, portfolio: portfolioSlug, session_id: sessionId }),
    });
    sessionId = session_id ?? sessionId;
    return [{ kind: 'text', text: reply }];
  };
}
