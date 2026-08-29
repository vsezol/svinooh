import { api } from './api';
import type { AgentBlock, Answerer } from './agent';

/**
 * Answers by asking the agent service through the gateway, rather than computing
 * in the browser (the `localAnswerer` stand-in). This is the `Answerer` the
 * design was waiting on — "a request to the agent service later".
 *
 * Today the service returns one paragraph, so an answer is a single text block.
 * As it grows to return the richer blocks the vocabulary already allows (stats,
 * charts, tables), only this file changes — everything above the `Answerer` seam
 * in AgentChat stays as it is.
 */
export const serviceAnswerer: Answerer = async (question): Promise<AgentBlock[]> => {
  const { reply } = await api<{ reply: string }>('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: question }),
  });
  return [{ kind: 'text', text: reply }];
};
