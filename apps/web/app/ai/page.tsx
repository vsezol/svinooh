import type { Metadata } from 'next';
import { AgentPage } from '../../src/screens/AgentPage';

/**
 * The app's front door. A conversation, not a form: what the landing's
 * composer was given is already in the log by the time this renders, and an
 * account is offered after the first answer rather than in front of it.
 */
export const metadata: Metadata = {
  title: 'Ask the svinooh agent — your DeFi copilot',
  description:
    'One agent that reads every position across 50+ chains and tells you what matters. Ask about a wallet, a pool or a health factor — no account needed to start.',
  alternates: { canonical: '/ai' },
};

export default function Ai() {
  return <AgentPage />;
}
