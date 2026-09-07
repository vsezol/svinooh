/**
 * What the shell knows about the agent — an address and a switch.
 *
 * The chat itself is not in this app any more: it is built and deployed with
 * the agent service and loaded at runtime as a federated remote (see
 * components/agent/AgentEmbed). The block vocabulary, the conversation state
 * and the widgets that draw them moved with it, which is why this file is two
 * constants and nothing else.
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
 * Where the agent deployment lives — its own origin, not this app's.
 *
 * One origin serves the remote entry and the wire it speaks, so the shell only
 * needs the address. Inlined at build time like every NEXT_PUBLIC_ value;
 * empty means the tab has nothing to load, which is every local run without
 * the variable.
 */
export const AGENT_URL: string = process.env.NEXT_PUBLIC_AGENT_URL || '';
