'use client';

import { useEffect, useRef, useState } from 'react';
import { CHIPS, THINKING, type AgentBlock, type Answerer, type ChatMessage } from '../../lib/agent';
import { AgentBlockView } from './AgentWidgets';

let counter = 0;
const nextId = (): string => `m${++counter}`;

/**
 * The agent tab.
 *
 * A conversation about a portfolio, and nothing else: no history, no threads,
 * no settings. What it knows how to do is ask a question, show that it is
 * working, and render an answer made of the widgets next door.
 *
 * `answer` is the whole seam. Everything above it — the composer, the openers,
 * the status line, the scroll — is finished and does not change when the
 * answering moves off this machine; everything below it is a promise of blocks.
 */
export function AgentChat({ answer }: { answer: Answerer }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** The question in flight, so a late answer to an abandoned one is dropped */
  const asking = useRef<string | null>(null);

  const thinking = status !== null;
  const empty = messages.length === 0 && !thinking;

  /**
   * Follow the conversation down as it grows. Only on a new message or on the
   * status appearing — scrolling on every render would fight anybody who has
   * scrolled up to re-read something.
   */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || thinking) return;

    const id = nextId();
    asking.current = id;
    setMessages((m) => [...m, { id, role: 'you', text: question }]);
    setDraft('');

    // Up on the keystroke that sent the question, so the wait is never silent.
    // What it SAYS stays neutral until the answerer tells us otherwise — only
    // the thing doing the work can honestly describe it.
    setStatus(THINKING);

    try {
      const blocks = await answer(question, (text) => {
        // A status from an abandoned question must not overwrite the live one
        if (asking.current === id) setStatus(text);
      });
      if (asking.current !== id) return;
      setMessages((m) => [...m, { id: nextId(), role: 'agent', blocks }]);
    } catch {
      if (asking.current !== id) return;
      setMessages((m) => [
        ...m,
        { id: nextId(), role: 'agent', blocks: [{ kind: 'text', text: 'That one did not go through. Ask again in a moment.' }] },
      ]);
    } finally {
      if (asking.current === id) {
        asking.current = null;
        setStatus(null);
      }
    }
  };

  return (
    <div className="agent-chat">
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 2px' }}>
        {empty ? <Welcome /> : null}

        {messages.map((message) =>
          message.role === 'you' ? (
            <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <div
                style={{
                  maxWidth: '82%',
                  background: 'var(--surf2)',
                  border: '1px solid var(--line)',
                  borderRadius: '18px 18px 6px 18px',
                  padding: '11px 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.55,
                }}
              >
                {message.text}
              </div>
            </div>
          ) : (
            <div key={message.id} style={{ marginTop: 18 }}>
              {(message.blocks ?? []).map((block, i) => (
                <AgentBlockView key={i} block={block} />
              ))}
            </div>
          ),
        )}

        {thinking ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0 6px' }}>
            <span
              className="spin"
              style={{ width: 14, height: 14, borderWidth: 2, flexShrink: 0 }}
              aria-hidden="true"
            />
            <span style={{ fontSize: 13.5, color: 'var(--mut)' }}>{status}…</span>
          </div>
        ) : null}
      </div>

      <div style={{ paddingTop: 10 }}>
        {/* The openers stay put rather than disappearing after the first
            question: a conversation about a portfolio is a series of separate
            questions, not one thread being refined */}
        <div className="agent-chips">
          {CHIPS.map((label) => (
            <button key={label} className="agent-chip" onClick={() => void send(label)} disabled={thinking}>
              {label}
            </button>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--line2)',
            borderRadius: 999,
            background: 'var(--surf)',
            padding: '5px 5px 5px 15px',
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send(draft);
            }}
            placeholder="Message the agent…"
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              minWidth: 0,
              height: 34,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              color: 'var(--text)',
            }}
          />
          <button
            onClick={() => void send(draft)}
            title="Send"
            aria-label="Send"
            disabled={!draft.trim() || thinking}
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              cursor: draft.trim() && !thinking ? 'pointer' : 'default',
              background: draft.trim() && !thinking ? 'var(--acc)' : 'var(--line)',
              color: draft.trim() && !thinking ? 'var(--acc-ink)' : 'var(--mut)',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/** What the tab says before anybody has asked it anything */
function Welcome() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '30px 10px',
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: '50%',
          background: 'var(--surf)',
          border: '1px solid var(--line2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* the logo's own two rings, at the size a face would be */}
        <span style={{ display: 'inline-flex', alignItems: 'baseline' }} aria-hidden="true">
          <span style={{ width: 13, height: 13, border: '3px solid var(--acc)', borderRadius: '50%' }} />
          <span
            style={{ width: 13, height: 13, border: '3px solid var(--acc)', borderRadius: '50%', marginLeft: -3 }}
          />
        </span>
      </div>
      <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', marginTop: 16 }}>
        Ask about your portfolio
      </div>
      <div
        className="mono"
        style={{ fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--acc-text)', marginTop: 8 }}
      >
        PORTFOLIO AGENT · BETA
      </div>
      <div
        style={{
          maxWidth: 360,
          fontSize: 13.5,
          lineHeight: 1.6,
          color: 'var(--mut)',
          marginTop: 14,
          textWrap: 'pretty',
        }}
      >
        It reads every wallet, pool and loan you track — positions, yields, health factors, and what moved
        today.
      </div>
    </div>
  );
}
