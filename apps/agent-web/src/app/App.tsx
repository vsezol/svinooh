import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem, Conversation, MountOptions, PortfolioRef, SignInBlock, TraceBlock } from './types';
import { useDesktop } from './useDesktop';
import { WireError, streamChat, type StepEvent } from './wire';
import * as history from './history';
import { AgentHeader } from '../components/AgentHeader';
import { AgentMessage } from '../components/AgentMessage';
import { Composer } from '../components/Composer';
import { Door } from '../components/Door';
import { EmptyGrounded } from '../components/EmptyGrounded';
import { OpenerChips } from '../components/OpenerChips';
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

/**
 * Four ways in, and they are not all about a portfolio on purpose.
 *
 * One reads what you hold, one asks it to do something with idle money, one is
 * a judgement call and one is a plain question with no account behind it. Four
 * openers that were all "what does my portfolio say" taught the first-time
 * reader that this is a portfolio viewer with a text box.
 */
const OPENERS = [
  'What changed this week?',
  'Put my idle USDC to work',
  'My riskiest position?',
  'Explain impermanent loss',
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

/**
 * The steps a turn reported, as a block.
 *
 * Every row here is an operation that ran: the id is the one the service used,
 * the label is what that operation said about itself, and the time is what it
 * actually took. Nothing is added to make the list look busier.
 */
function traceOf(steps: StepEvent[], collapsed: boolean): TraceBlock {
  const ms = steps.reduce((sum, step) => sum + (step.ms ?? 0), 0);
  return {
    kind: 'trace',
    collapsed,
    summary: `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} · ${(ms / 1000).toFixed(1)}s`,
    steps: steps.map((step) => ({
      label: step.label ?? step.id,
      state: step.state === 'running' ? 'running' : 'done',
      time: step.ms === undefined ? undefined : `${(step.ms / 1000).toFixed(1)}s`,
    })),
  };
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

export function App(props: AppProps) {
  const {
    agentUrl,
    token,
    variant = 'embedded',
    locked = false,
    signedIn = false,
    demoConversation,
    demoHistoryList,
    onConversations,
    control,
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
  // The answer as it is being written. Held apart from the conversation on
  // purpose: nothing is committed to the log — or to storage — until the turn
  // has finished, so a stream that dies halfway leaves the chat as it was.
  const [streamed, setStreamed] = useState<string | null>(null);
  // What the turn is doing, as it reports itself. Held beside the log like the
  // streaming text: it belongs to the turn in flight, not to the conversation.
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(true);
  /** The same list, readable when the turn ends without waiting for a render. */
  const stepsRef = useRef<StepEvent[]>([]);
  /** Which finished answers have their receipt open. Folded is the default. */
  const [openTraces, setOpenTraces] = useState<ReadonlySet<string>>(() => new Set());
  /** Whether the transcript has been scrolled — what folds the header. */
  const [logScrolled, setLogScrolled] = useState(false);
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
      setStreamed(null);
      setSteps([]);
      stepsRef.current = [];
      setTraceOpen(true);
      // Which conversation asked. An answer that arrives after the user has
      // started a new chat — or opened an older one — belongs to neither of
      // them, and appending it there is how a fresh chat ends up replying to
      // a question it never saw. Streaming makes this matter more, not less:
      // now it is every piece that has to be checked, not one arrival.
      const asked = activeRef.current.id;
      try {
        const res = await streamChat(
          {
            agentUrl,
            token,
            portfolio: slug,
            sessionId: activeRef.current.sessionId,
            message: text,
          },
          {
            onToken: (piece) => {
              if (activeRef.current.id !== asked) return;
              setStreamed((sofar) => (sofar ?? '') + piece);
            },
            // Every one of these is an operation that ran, reported by the code
            // that ran it. A line closing carries how long it took; a line
            // opening is a line that has not finished yet.
            onStep: (event) => {
              if (activeRef.current.id !== asked) return;
              setSteps((sofar) => {
                const at = sofar.findIndex((s) => s.id === event.id);
                const next = at === -1 ? [...sofar, event] : sofar.slice();
                if (at !== -1) next[at] = { ...next[at], ...event };
                stepsRef.current = next;
                return next;
              });
            },
          },
        );
        if (activeRef.current.id !== asked) return;
        activeRef.current = { ...activeRef.current, sessionId: res.sessionId };
        // The finished blocks replace the text that was being watched, rather
        // than the text being kept: what arrived as pieces was a preview, and
        // an answer can be more than the words in it — a sign-in prompt, a
        // confirmation to press.
        //
        // The receipt rides with them, folded. It belongs to this turn rather
        // than to the screen, so scrolling back to an old answer still shows
        // what that answer was built from.
        const receipt = stepsRef.current;
        push([
          {
            id: uid(),
            role: 'agent',
            blocks: receipt.length > 0 ? [traceOf(receipt, true), ...res.blocks] : res.blocks,
          },
        ]);
      } catch (err) {
        if (activeRef.current.id !== asked) return;
        push(notesFor(err, text));
      } finally {
        setBusy(false);
        setStreamed(null);
        // The receipt is on the message now; the floating copy goes.
        setSteps([]);
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

  // What the host's rail draws, whenever it changes. Published rather than
  // handed over: the conversations are still this component's, and a rail that
  // owned them would be a second copy of the same list.
  useEffect(() => {
    onConversations?.(
      conversations.map((c) => ({
        id: c.id,
        title: c.title,
        at: c.at,
        active: c.id === active.id,
      })),
    );
  }, [conversations, active.id, onConversations]);

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

  // The handle the host holds. Assigned rather than returned, because mount()
  // has already returned by the time this component exists.
  useEffect(() => {
    if (!control) return;
    control.newChat = newChat;
    control.openConversation = selectConversation;
  });

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
  }, [active, busy, statusText, streamed]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    // The same threshold the kit uses on a page: small, because the fold is
    // what the gesture is for.
    const read = () => setLogScrolled(el.scrollTop > 24);
    read();
    el.addEventListener('scroll', read, { passive: true });
    return () => el.removeEventListener('scroll', read);
  }, []);

  const empty = active.items.length === 0;
  const lastRole = active.items[active.items.length - 1]?.role;
  // Demo conversations end on status lines and hold the thinking state open.
  // The pulse is for the wait before the first word. Once words are arriving
  // they are the better answer to "is anything happening".
  const thinking = (busy && streamed === null) || lastRole === 'status';

  // The live trace, built from what the turn reported about itself. It folds
  // as soon as the answer starts: the steps mattered while they ran.
  const traceBlock = traceOf(steps, !traceOpen || streamed !== null);

  const meta =
    portfolio && portfolio.wallets != null && portfolio.totalUsd != null
      ? `${portfolio.wallets} WALLETS · $${Math.round(portfolio.totalUsd).toLocaleString('en-US')}`
      : undefined;

  // One placeholder, and it says both halves of what this is: a thing you ask,
  // and a thing you set going. Three of them that changed with your account
  // state were three different promises about the same box.
  const placeholder = 'Ask or give a task…';

  // One opening, plus a way in for somebody who has not got one. Having no
  // portfolio is not a different screen any more — the assistant answers
  // without one and can make one for you, so a chat that opens by saying you
  // are missing something was starting on the wrong foot.
  const emptyView = !empty ? null : !signedIn && variant === 'standalone'
    ? <Door onSignIn={onSignIn} />
    : <EmptyGrounded />;

  const toggleTrace = useCallback((id: string) => {
    setOpenTraces((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const renderItem = (item: ChatItem) => {
    switch (item.role) {
      case 'user':
        return <UserBubble key={item.id} text={item.text} />;
      case 'agent':
        return (
          <AgentMessage key={item.id}>
            {item.blocks.map((block, i) => (
              <BlockView
                key={i}
                // A receipt opens per answer rather than for all of them: two
                // turns' worth of steps unfolding together is not what anybody
                // clicked for.
                block={
                  block.kind === 'trace'
                    ? { ...(block as TraceBlock), collapsed: !openTraces.has(item.id) }
                    : block
                }
                onSignIn={onSignIn}
                onAction={onAction}
                onToggleTrace={() => toggleTrace(item.id)}
                busy={busy}
              />
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
          // The page does not scroll here — the transcript does — so the fold
          // is this screen's to report rather than the header's to detect.
          collapsed={logScrolled}
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
          {/* One column, not four. The topbar, the transcript, the openers and
              the composer each used to cap themselves at 720px independently,
              and the openers capped at nothing at all -- so on a wide window
              they began at the left edge of the pane while the composer sat
              centred under them. They share a column now, which is what the
              design draws: everything that stacks is the same width, aligned
              on the same two edges, and there is one number to change. */}
          <div className="sv-a-col">
            {/* Standalone only. Embedded, the host draws the portfolio in its
                header and New chat and History in its rail — see the mount
                handle — so a row here would be the third place saying it. */}
            {variant === 'standalone' && portfolio ? (
              <div className="sv-a-topbar" data-variant={variant}>
                <GroundingChip portfolio={portfolio} onClick={() => setSwitcherOpen(true)} />
              </div>
            ) : null}
            <div className="sv-a-log" ref={logRef}>
              {empty && emptyView ? (
                <div className="sv-a-empty">{emptyView}</div>
              ) : (
                <div className="sv-a-items">
                  {active.items.map(renderItem)}
                  {/* The turn in flight: what it is doing, then what it is
                      saying. The trace folds itself once words start arriving —
                      the steps were the answer to "is anything happening", and
                      the words are a better one. */}
                  {steps.length > 0 ? (
                    <AgentMessage>
                      <BlockView
                        block={traceBlock}
                        onToggleTrace={() => setTraceOpen((open) => !open)}
                      />
                    </AgentMessage>
                  ) : null}
                  {streamed === null ? null : (
                    <AgentMessage>
                      <BlockView
                        block={{ kind: 'text', text: streamed }}
                        onSignIn={onSignIn}
                        onAction={onAction}
                        busy
                      />
                    </AgentMessage>
                  )}
                  {statusText ? <StatusLine text={statusText} /> : null}
                  {/* Only before the first step lands: after that the trace is
                      the better spinner, because it says what it is waiting on. */}
                  {thinking && steps.length === 0 ? <ThinkingPulse /> : null}
                </div>
              )}
            </div>
            {/* Against the composer, where the design puts them: they are the
                fastest way to start typing, so they belong next to where you
                type rather than centred in the space above it. */}
            {empty ? <OpenerChips chips={OPENERS} onPick={send} /> : null}
            <div className="sv-a-composer">
              {locked ? <ProLock /> : <Composer placeholder={placeholder} disabled={demo} onSend={send} />}
            </div>
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
