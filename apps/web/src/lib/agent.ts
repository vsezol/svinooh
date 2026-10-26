/**
 * What the shell knows about the agent service — an address and a switch.
 *
 * The chat itself lives in src/agent and is mounted by components/agent/
 * AgentEmbed; this file is only where its questions go.
 */

/**
 * Whether the agent tab is reachable at all.
 *
 * Both navigations and the pane read it, so neither can end up offering a page
 * the other hides. Deliberately not an env var: it is a decision about what is
 * finished, and it changes in a commit somebody can point at.
 */
export const AGENT_ENABLED = true;

/**
 * The agent API — where questions go.
 *
 * Inlined at build time like every NEXT_PUBLIC_ value; empty means the tab has
 * nothing to talk to, which is every local run without the variable.
 */
export const AGENT_URL: string = process.env.NEXT_PUBLIC_AGENT_URL || '';
