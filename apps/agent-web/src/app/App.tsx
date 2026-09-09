import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem, Conversation, MountOptions, PortfolioRef, SignInBlock, TraceBlock } from './types';
import { useDesktop } from './useDesktop';
import { WireError, streamChat, type StepEvent } from './wire';
import { traceOf } from './trace';
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
 * A clock that runs only while a turn does.
 *
 * Ten times a second, which is slower than the re-renders a streaming answer
 * already causes and only runs when there is something to count.
 */
function useTicking(on: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) {
      setNow(0);
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
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
    initialQuestion,
    demoConversation,
    demoHistoryList,
    onConversations,
    onConversationId,
    control,
    onToggleTheme,
  } = props;
  const demo = demoConversation != null;
  // What every call to the conversation store needs. Rebuilt when the token
  // arrives, which is also when the list is worth asking for again: signing in
  // hands somebody their own conversations rather than this browser's.
  const chats = useMemo(() => ({ agentUrl, token }), [agentUrl, token]);

  // Grounding can change from the switcher without a remount, so the prop
  // only seeds it.
  const [slug, setSlug] = useState(props.portfolioSlug);
  const portfolio: PortfolioRef | undefined = useMemo(
    () => props.portfolios?.find((p) => p.slug === slug) ?? (slug ? { slug, name: slug } : undefined),
    [props.portfolios, slug],
  );
  const noPortfolio = signedIn && !slug && (props.portfolios?.length ?? 0) === 0;

  const [conversations, setConversations] = useState<Conversation[]>(() => demoHistoryList ?? []);
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

  /**
   * Put items in the conversation on screen.
   *
   * Only on screen: the turn itself is stored by the service, as part of
   * answering it. This used to write to localStorage here, which is precisely
   * the two-copies-of-one-conversation the durable store removed — the log you
   * were looking at and the context the model was replayed were different
   * records, and only one of them survived a restart.
   */
  const push = useCallback((items: ChatItem[]) => {
    const cur = activeRef.current;
    const next: Conversation = { ...cur, at: Date.now(), items: [...cur.items, ...items] };
    activeRef.current = next;
    setActive(next);
  }, []);

  /** The rail's list, re-read from the service — the only thing that has it. */
  const refresh = useCallback(async () => {
    if (demo) return;
    setConversations(await history.list(chats));
  }, [demo, chats]);

  // The list on load, and again whenever the token changes: signing in makes
  // the same browser a different caller, with conversations of its own.
  useEffect(() => {
    // The browser-local store this replaced. Dropped rather than migrated —
    // see the note in history.ts about whose records those would be.
    history.retireLocalHistory();
    void refresh();
  }, [refresh]);

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
                // The first time a step is heard of is when its line appears,
                // which is what a running one counts up from.
                const next = at === -1 ? [...sofar, { ...event, startedAt: Date.now() }] : sofar.slice();
                if (at !== -1) next[at] = { ...next[at], ...event };
                stepsRef.current = next;
                return next;
              });
            },
          },
        );
        if (activeRef.current.id !== asked) return;
        // The conversation takes the service's id for its own, which is what
        // gives it an address from its first turn. Safe to change here and
        // nowhere earlier: every guard above compares against `asked`, and
        // this runs once they have all passed. Until now a fresh chat was
        // known only by a local handle, which is why the rail could not tell
        // which row was the one on screen.
        activeRef.current = { ...activeRef.current, id: res.sessionId, sessionId: res.sessionId };
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
            // Every step in a finished receipt has its own time, so there is
            // nothing left for a clock to count.
            blocks: receipt.length > 0 ? [traceOf(receipt, true, 0), ...res.blocks] : res.blocks,
          },
        ]);
        // The rail learns about the conversation from the service rather than
        // from a copy kept here — including its name, which the service
        // derives from the first question the same way this used to.
        void refresh();
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
    [agentUrl, token, slug, push, refresh],
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

  /**
   * The question the host handed over, put to the chat as if it had been typed.
   *
   * Watched rather than read at mount: the host holds it back until it knows
   * who is asking, and a returning visitor's token lands a moment after the
   * page does. A portfolio question asked in that moment would be answered for
   * a stranger.
   *
   * Once, ever. The guard is a ref rather than a dependency because `send` is
   * rebuilt whenever the turn's busy state changes, and the first thing this
   * does is make it busy.
   */
  const handedOver = useRef(false);
  useEffect(() => {
    if (handedOver.current || !initialQuestion) return;
    handedOver.current = true;
    send(initialQuestion);
  }, [initialQuestion, send]);

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

  /**
   * The conversation's address, for the host to put in the URL.
   *
   * Null until the first turn has been answered: a chat nobody has spoken to
   * has nothing at its address yet, and `/ai` is the right place to be while
   * that is true.
   */
  useEffect(() => {
    onConversationId?.(active.sessionId ?? null);
  }, [active.sessionId, onConversationId]);

  /**
   * Which conversation is being fetched, so a slower earlier one cannot land
   * on top of it. Opening two rows quickly used to be free — they were both
   * already in memory — and is a race now that a transcript is a request.
   */
  const opening = useRef<string | null>(null);

  const selectConversation = useCallback(
    (id: string) => {
      setHistoryOpen(false);
      if (activeRef.current.id === id) return;
      if (demo) {
        const found = conversations.find((c) => c.id === id);
        if (found) {
          activeRef.current = found;
          setActive(found);
        }
        return;
      }
      opening.current = id;
      void (async () => {
        const opened = await history.read(chats, id);
        if (opening.current !== id) return;
        opening.current = null;
        // Somebody else's id finds nothing — the service answers 404 rather
        // than confirming it exists — and so does one whose thirty days are
        // up. Both are a new chat rather than an error page: the link no
        // longer leads anywhere, and there is nothing to explain about a
        // conversation we are not allowed to say anything about.
        const next = opened ?? blank();
        activeRef.current = next;
        setActive(next);
      })();
    },
    [demo, conversations, chats],
  );

  // The handle the host holds. Assigned rather than returned, because mount()
  // has already returned by the time this component exists.
  useEffect(() => {
    if (!control) return;
    control.newChat = newChat;
    control.openConversation = selectConversation;
    control.openHistory = () => setHistoryOpen(true);
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
  const now = useTicking(busy);
  const traceBlock = traceOf(steps, !traceOpen || streamed !== null, now);

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
            <HistoryPanel
              mode="rail"
              conversations={conversations}
              currentId={active.id}
              onSelect={selectConversation}
              onNew={newChat}
            />
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
