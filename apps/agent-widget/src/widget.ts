/**
 * The svinooh AI agent chat, as an embeddable widget.
 *
 * One exposed function: mount(el, opts). The host — the portfolio web app
 * today, the standalone agent page later — owns nothing but that call: the
 * widget builds its own DOM, injects its own styles, talks to the agent
 * service directly over its public domain (the browser door opened in M2),
 * and hands back an unmount().
 *
 * Module scope touches no DOM, so the bundle can load anywhere (including a
 * script tag in <head>) and only mount() renders. Styles lean on the host's
 * design tokens (--surf, --text, --acc...) with dark fallbacks, so embedded
 * it inherits the product look and standalone it still looks like svinooh.
 */

export interface MountOptions {
  /** The agent service origin, e.g. https://agent-production-xxxx.up.railway.app */
  agentUrl: string;
  /** The caller's JWT (no "Bearer" prefix) — the shell hands it in; absent means anonymous. */
  token?: string;
  /** The portfolio on the host's screen, if any — grounds the answers. */
  portfolioSlug?: string;
  theme?: 'dark' | 'light';
}

export interface Handle {
  unmount(): void;
}

/** The wire this widget speaks (the agent's ChatResponse contract). */
const WIRE_SCHEMA = 1;

interface TextBlock {
  kind: 'text';
  text: string;
}

interface ChatWire {
  schema: number;
  blocks: TextBlock[];
  session_id: string;
}

const STYLE_ID = 'sv-agent-widget-style';

const CSS = `
.sv-agent{display:flex;flex-direction:column;height:100%;min-height:320px;
  font-family:var(--sans,system-ui,sans-serif);color:var(--text,#edeff4);
  background:var(--surf,#0d0f14);border:1px solid var(--line,#1b1f28);
  border-radius:12px;overflow:hidden}
.sv-agent-log{flex:1;overflow-y:auto;padding:14px;display:flex;
  flex-direction:column;gap:10px}
.sv-agent-msg{max-width:85%;padding:8px 12px;border-radius:10px;
  white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.45}
.sv-agent-msg.user{align-self:flex-end;background:var(--acc-soft,rgba(43,213,118,.13));
  color:var(--text,#edeff4)}
.sv-agent-msg.agent{align-self:flex-start;background:var(--surf2,#12151c)}
.sv-agent-msg.note{align-self:center;background:none;color:var(--mut,#9aa1af);
  font-size:12.5px}
.sv-agent-empty{margin:auto;color:var(--mut,#9aa1af);font-size:13.5px;text-align:center}
.sv-agent-row{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,#1b1f28)}
.sv-agent-input{flex:1;padding:9px 12px;border-radius:9px;font-size:14px;
  border:1px solid var(--line2,#262c38);background:var(--surf2,#12151c);
  color:var(--text,#edeff4);outline:none}
.sv-agent-input:focus{border-color:var(--acc,#2bd576)}
.sv-agent-send{padding:9px 16px;border-radius:9px;border:none;font-size:14px;
  font-weight:600;background:var(--acc,#2bd576);color:var(--acc-ink,#07130c);
  cursor:pointer}
.sv-agent-send:disabled{opacity:.45;cursor:default}
.sv-agent-busy{align-self:flex-start;color:var(--mut,#9aa1af);font-size:13px;
  animation:svAgentPulse 1.1s ease-in-out infinite}
@keyframes svAgentPulse{0%,100%{opacity:1}50%{opacity:.35}}
`;

function ensureStyles(doc: Document): void {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mount(root: HTMLElement, opts: MountOptions): Handle {
  const doc = root.ownerDocument;
  ensureStyles(doc);

  const box = el(doc, 'div', 'sv-agent');
  if (opts.theme) box.dataset.theme = opts.theme;
  const log = el(doc, 'div', 'sv-agent-log');
  const empty = el(
    doc,
    'div',
    'sv-agent-empty',
    'Ask about your portfolio, a position, or how something in DeFi works.',
  );
  log.appendChild(empty);
  // A real form, so Enter-to-send and the mobile keyboard's Go button come
  // from the browser instead of a keydown listener.
  const row = el(doc, 'form', 'sv-agent-row');
  const input = el(doc, 'input', 'sv-agent-input');
  input.placeholder = 'Ask the agent';
  const send = el(doc, 'button', 'sv-agent-send', 'Send');
  send.type = 'submit';
  row.append(input, send);
  box.append(log, row);
  root.appendChild(box);

  let sessionId: string | undefined;
  let busy = false;
  let disposed = false;
  const aborter = new AbortController();

  const say = (kind: 'user' | 'agent' | 'note', text: string) => {
    empty.remove();
    log.appendChild(el(doc, 'div', `sv-agent-msg ${kind}`, text));
    log.scrollTop = log.scrollHeight;
  };

  const failureText = (status: number, retryAfter: string | null): string => {
    if (status === 401) return 'Your session has expired — sign in again to continue.';
    if (status === 429) {
      const wait = retryAfter ? ` Try again in about ${retryAfter}s.` : '';
      return `Rate limit reached.${wait}`;
    }
    return 'The agent is unavailable right now — try again in a moment.';
  };

  const ask = async (question: string): Promise<void> => {
    busy = true;
    send.disabled = true;
    const thinking = el(doc, 'div', 'sv-agent-busy', 'Thinking');
    log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
      const res = await fetch(`${opts.agentUrl.replace(/\/$/, '')}/chat`, {
        method: 'POST',
        headers,
        signal: aborter.signal,
        body: JSON.stringify({
          message: question,
          session_id: sessionId,
          portfolio: opts.portfolioSlug,
        }),
      });
      if (!res.ok) {
        say('note', failureText(res.status, res.headers.get('Retry-After')));
        return;
      }
      const wire = (await res.json()) as ChatWire;
      if (wire.schema !== WIRE_SCHEMA) {
        say('note', 'This chat is out of date with the agent — refresh the page.');
        return;
      }
      sessionId = wire.session_id;
      for (const block of wire.blocks) {
        // The vocabulary will grow; an unknown kind degrades to a note
        // instead of rendering nothing silently.
        if (block.kind === 'text') say('agent', block.text);
        else say('note', `[unsupported block: ${(block as { kind: string }).kind}]`);
      }
    } catch (error) {
      if (!disposed) say('note', failureText(0, null));
    } finally {
      thinking.remove();
      busy = false;
      send.disabled = false;
      if (!disposed) input.focus();
    }
  };

  row.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;
    input.value = '';
    say('user', question);
    void ask(question);
  });

  return {
    unmount() {
      disposed = true;
      aborter.abort();
      box.remove();
    },
  };
}
