import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem, Conversation, MountOptions, PortfolioRef, SignInBlock } from './types';
import { WireError, sendChat } from './wire';
import * as history from './history';
import { AgentHeader } from '../components/AgentHeader';
import { AgentMessage } from '../components/AgentMessage';
import { Composer } from '../components/Composer';
import { Door } from '../components/Door';
import { EmptyGrounded } from '../components/EmptyGrounded';
import { EmptyNoPortfolio } from '../components/EmptyNoPortfolio';
import { GroundingChip } from '../components/GroundingChip';
import { HistoryPanel } from '../components/HistoryPanel';
import { Rail } from '../components/Rail';
import { PortfolioSwitcher } from '../components/PortfolioSwitcher';
import { ProLock } from '../components/ProLock';
import { StatusLine } from '../components/StatusLine';
import { SystemNote } from '../components/SystemNote';
import { ThinkingPulse } from '../components/ThinkingPulse';
import { UserBubble } from '../components/UserBubble';
import BlockView from '../components/blocks';

const OPENERS = [
  'What changed this week?',
  'My riskiest position?',
  'Explain my health factor',
  'Where is my money by chain?',
];

const SIGNIN_TITLE = 'Sign in to see your portfolio';
const SIGNIN_SUB = 'Portfolio answers need your account. General DeFi questions work without it.';

export type AppProps = MountOptions & {
  demoConversation?: Conversation;
  demoHistoryList?: Conversation[];
  onToggleTheme?: () => void;
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function blank(): Conversation {
  return { id: uid(), title: 'New chat', at: Date.now(), items: [] };
}

function notesFor(err: unknown, question: string): ChatItem[] {
  if (err instanceof WireError) {
    if (err.status === 401) {
      const block: SignInBlock = {
        kind: 'signin',
        title: SIGNIN_TITLE,
        sub: SIGNIN_SUB,
        pendingQuestion: question,
      };
      return [
        { id: uid(), role: 'note', text: 'Session expired.' },
        { id: uid(), role: 'agent', blocks: [block] },
      ];
    }
    if (err.status === 429) {
      return [
        {
          id: uid(),
          role: 'note',
          text:
            err.retryAfterS != null
              ? `Rate limited — retry in ${err.retryAfterS}s.`
              : 'Rate limited — retry shortly.',
          retryAfterS: err.retryAfterS,
        },
      ];
    }
  }
  // Covers network failure (status 0) and every unexpected status: the
  // question already sits in the log and is persisted with it.
  return [{ id: uid(), role: 'note', text: 'The agent is unavailable right now. Your question is saved.' }];
}

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

export function App(props: AppProps) {
  const {
    agentUrl,
    token,
    variant = 'embedded',
    locked = false,
    signedIn = false,
    demoConversation,
    demoHistoryList,
    onToggleTheme,
  } = props;
  const demo = demoConversation != null;

  // Grounding can change from the switcher without a remount, so the prop
  // only seeds it.
  const [slug, setSlug] = useState(props.portfolioSlug);
  const portfolio: PortfolioRef | undefined = useMemo(
    () => props.portfolios?.find((p) => p.slug === slug) ?? (slug ? { slug, name: slug } : undefined),
    [props.portfolios, slug],
  );
  const noPortfolio = signedIn && !slug && (props.portfolios?.length ?? 0) === 0;

  const [conversations, setConversations] = useState<Conversation[]>(
    () => demoHistoryList ?? history.list(),
  );
  const [active, setActive] = useState<Conversation>(() => demoConversation ?? blank());
  const activeRef = useRef(active);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const lastQuestion = useRef<string | null>(null);
  const desktop = useDesktop();
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback(
    (items: ChatItem[]) => {
      const cur = activeRef.current;
      const next: Conversation = { ...cur, at: Date.now(), items: [...cur.items, ...items] };
      activeRef.current = next;
      setActive(next);
      if (!demo) {
        const saved = history.save(next);
        // Empty read-back means storage is unavailable: keep at least the
        // live conversation in the in-memory list.
        const stored = history.list();
        setConversations((prev) =>
          stored.length > 0 ? stored : [saved, ...prev.filter((c) => c.id !== saved.id)],
        );
      }
    },
    [demo],
  );

  const ask = useCallback(
    async (text: string) => {
      lastQuestion.current = text;
      setBusy(true);
      // Which conversation asked. An answer that arrives after the user has
      // started a new chat — or opened an older one — belongs to neither of
      // them, and appending it there is how a fresh chat ends up replying to
      // a question it never saw.
      const asked = activeRef.current.id;
      try {
        const res = await sendChat({
          agentUrl,
          token,
          portfolio: slug,
          sessionId: activeRef.current.sessionId,
          message: text,
        });
        if (activeRef.current.id !== asked) return;
        activeRef.current = { ...activeRef.current, sessionId: res.sessionId };
        push([{ id: uid(), role: 'agent', blocks: res.blocks }]);
      } catch (err) {
        if (activeRef.current.id !== asked) return;
        push(notesFor(err, text));
      } finally {
        setBusy(false);
        setStatusText(null);
      }
    },
    [agentUrl, token, slug, push],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busy || demo) return;
      push([{ id: uid(), role: 'user', text }]);
      void ask(text);
    },
    [busy, demo, push, ask],
  );

  const retryLast = useCallback(() => {
    // Retries re-ask without another user bubble — the question is already
    // the last one in the log.
    const question = lastQuestion.current;
    if (question && !busy) void ask(question);
  }, [busy, ask]);

  const onAction = useCallback(
    (action: 'confirm' | 'cancel') => {
      // The service reads the literal reply as the confirmation turn.
      send(action === 'confirm' ? 'Create portfolio' : 'Cancel');
    },
    [send],
  );

  const onSignIn = useCallback(
    (provider: string) => {
      if (variant === 'embedded') {
        // The widget runs in the shell's own window: an event, not a
        // postMessage, reaches the shell so it can open its auth modal.
        window.dispatchEvent(new CustomEvent('svinooh:agent-signin', { detail: { provider } }));
        return;
      }
      // Standalone sends the visitor to the product's door for now; the
      // dedicated redirect flow for the agent origin is wired later.
      window.location.href = 'https://svinooh.com/?signin=1';
    },
    [variant],
  );

  const newChat = useCallback(() => {
    const next = blank();
    activeRef.current = next;
    setActive(next);
    setHistoryOpen(false);
  }, []);

  const selectConversation = useCallback(
    (id: string) => {
      const found = conversations.find((c) => c.id === id);
      if (found) {
        activeRef.current = found;
        setActive(found);
      }
      setHistoryOpen(false);
    },
    [conversations],
  );

  const pickPortfolio = useCallback((nextSlug: string) => {
    setSlug(nextSlug);
    setSwitcherOpen(false);
  }, []);

  useEffect(() => {
    // On the next frame: the height a new message adds is not known until the
    // browser has laid it out, and scrolling before that lands short.
    const frame = requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, busy, statusText]);

  const empty = active.items.length === 0;
  const lastRole = active.items[active.items.length - 1]?.role;
  // Demo conversations end on status lines and hold the thinking state open.
  const thinking = busy || lastRole === 'status';

  const meta =
    portfolio && portfolio.wallets != null && portfolio.totalUsd != null
      ? `${portfolio.wallets} WALLETS · $${Math.round(portfolio.totalUsd).toLocaleString('en-US')}`
      : undefined;

  const placeholder = !signedIn
    ? 'Ask about DeFi…'
    : noPortfolio
      ? 'Paste wallet addresses…'
      : `Ask about ${portfolio?.name ?? 'your portfolio'}…`;

  let emptyView = null;
  if (empty) {
    if (!signedIn && variant === 'standalone') {
      emptyView = <Door onSignIn={onSignIn} />;
    } else if (noPortfolio) {
      emptyView = <EmptyNoPortfolio />;
    } else if (signedIn) {
      emptyView = <EmptyGrounded portfolio={portfolio} meta={meta} chips={OPENERS} onPick={send} />;
    }
  }

  const renderItem = (item: ChatItem) => {
    switch (item.role) {
      case 'user':
        return <UserBubble key={item.id} text={item.text} />;
      case 'agent':
        return (
          <AgentMessage key={item.id}>
            {item.blocks.map((block, i) => (
              <BlockView key={i} block={block} onSignIn={onSignIn} onAction={onAction} busy={busy} />
            ))}
          </AgentMessage>
        );
      case 'note':
        return (
          <SystemNote
            key={item.id}
            text={item.text}
            retryAfterS={item.retryAfterS}
            onRetry={item.retryAfterS != null ? retryLast : undefined}
          />
        );
      case 'status':
        return <StatusLine key={item.id} text={item.text} />;
    }
  };

  return (
    <div className="sv-a-root" data-variant={variant}>
      {variant === 'standalone' ? (
        <AgentHeader
          variant={variant}
          signedIn={signedIn}
          onToggleTheme={onToggleTheme}
          onHistory={() => setHistoryOpen(true)}
          onNewChat={newChat}
          onSignIn={() => onSignIn('telegram')}
        />
      ) : null}
      <div className="sv-a-body">
        {variant === 'standalone' ? (
          <Rail>
            {(collapsed) => (
              <HistoryPanel
                mode="rail"
                collapsed={collapsed}
                conversations={conversations}
                currentId={active.id}
                onSelect={selectConversation}
                onNew={newChat}
              />
            )}
          </Rail>
        ) : null}
        <div className="sv-a-main">
          {variant === 'embedded' || portfolio ? (
            // The grounding chip belongs to both hosts (the canvas shows it on
            // the standalone boards too); the New chat / History buttons only
            // to the embedded bar — standalone carries them in its header and
            // rail.
            <div className="sv-a-topbar">
              <GroundingChip portfolio={portfolio} onClick={() => setSwitcherOpen(true)} />
              {variant === 'embedded' ? (
                <div className="sv-a-topbar-actions">
                  <button type="button" className="ui-btn" data-variant="soft" data-size="sm" onClick={newChat}>
                    New chat
                  </button>
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="soft"
                    data-size="sm"
                    onClick={() => setHistoryOpen(true)}
                  >
                    History
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="sv-a-log" ref={logRef}>
            {empty && emptyView ? (
              <div className="sv-a-empty">{emptyView}</div>
            ) : (
              <div className="sv-a-items">
                {active.items.map(renderItem)}
                {statusText ? <StatusLine text={statusText} /> : null}
                {thinking ? <ThinkingPulse /> : null}
              </div>
            )}
          </div>
          <div className="sv-a-composer">
            {locked ? <ProLock /> : <Composer placeholder={placeholder} disabled={demo} onSend={send} />}
          </div>
        </div>
      </div>
      {historyOpen ? (
        <HistoryPanel
          mode={desktop ? 'popover' : 'sheet'}
          conversations={conversations}
          currentId={active.id}
          onSelect={selectConversation}
          onNew={newChat}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      <PortfolioSwitcher
        open={switcherOpen}
        portfolios={props.portfolios ?? []}
        currentSlug={slug}
        onSelect={pickPortfolio}
        onClose={() => setSwitcherOpen(false)}
        mode={desktop ? 'popover' : 'sheet'}
      />
    </div>
  );
}
