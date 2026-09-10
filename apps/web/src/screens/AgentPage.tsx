'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppHeader, Button } from '../ui';
import { AccountMenu } from '../components/AccountMenu';
import { AgentEmbed, type AgentControl, type ConversationRef } from '../components/agent/AgentEmbed';
import { AuthModal } from '../components/AuthModal';
import { SideNav, type Tab } from '../components/SideNav';
import { ThemeToggle } from '../components/ThemeToggle';
import { TAB_PARAM, tabsFor } from '../components/tabs';
import { AGENT_ENABLED, AGENT_URL, AGENT_WIDGET_URL } from '../lib/agent';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clearQuestion, peekQuestion } from '../lib/handoff';

/**
 * /ai — the app's front door, which is a conversation.
 *
 * The chat is the page here rather than a tab on somebody's portfolio, and it
 * works signed out: an account is offered after the first answer, when there
 * is something worth keeping, which is the whole shape of the landing above
 * it. A question typed there is already in the log by the time this appears —
 * see lib/handoff.
 *
 * The two other pages are places rather than panes. Somebody with a portfolio
 * has real ones to go to and the strip navigates; somebody without has nothing
 * behind them yet, and the pane says what would put something there instead of
 * showing an empty frame.
 */

/** What Portfolio and Alerts have to say to somebody who has neither yet. */
const NOTHING_YET: Record<'portfolio' | 'notifications', { title: string; body: string }> = {
  portfolio: {
    title: 'No wallets yet',
    body: 'Paste an address in the chat and the agent sets it up.',
  },
  notifications: {
    title: 'No alerts yet',
    body: 'Ask the agent to watch a health factor or a pool range.',
  },
};

const ICON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
} as const;

export function AgentPage({ conversationId }: { conversationId?: string } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, loading: authLoading, logout } = useAuth();
  const [conversations, setConversations] = useState<ConversationRef[]>([]);
  const agent = useRef<AgentControl | null>(null);
  /**
   * The conversation on screen, as the chat reports it — and whether the chat
   * is up at all, which is the same signal: it says so once on mount, with
   * null, before anything has been asked.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * Whether a conversation we asked the chat to open is still being fetched.
   *
   * The chat answers by reporting which conversation is on screen — the one we
   * named, or a fresh blank one when that id is not ours. Until it does, the
   * URL must not be touched: the address on screen is a link somebody
   * followed, and rewriting it from the not-yet-loaded state would bounce them
   * to /ai and back.
   */
  const awaitingOpen = useRef(false);
  const onConversationId = useCallback((id: string | null) => {
    awaitingOpen.current = false;
    setReady(true);
    setActiveId(id);
  }, []);
  const [authOpen, setAuthOpen] = useState(false);
  /** Which of the three the strip is pointing at. */
  const [view, setView] = useState<Tab>('agent');
  /**
   * The question the landing parked — read once, and spent as soon as it is
   * read, so a reload of this page is a fresh chat rather than the same
   * question asked again. See lib/handoff for why those are two steps.
   */
  const [parked] = useState(peekQuestion);
  useEffect(clearQuestion, []);
  /**
   * Whether we know who is asking yet.
   *
   * The question waits for this. A returning visitor's token arrives a moment
   * after the page does, and a portfolio question asked in that moment would
   * be answered for a stranger — "portfolio questions need sign-in" to
   * somebody who is signed in. Nothing to wait for when there is no token in
   * the first place, which is the visit this page was built for.
   */
  const [noToken, setNoToken] = useState(false);
  useEffect(() => {
    if (!tokenStore.get()) setNoToken(true);
  }, []);
  const known = noToken || !authLoading;

  const isAdmin = me?.isAdmin === true;
  const tabs = useMemo(() => tabsFor(isAdmin), [isAdmin]);
  const slug = me?.portfolioSlug;
  const token = me ? (tokenStore.get() ?? undefined) : undefined;

  // The chat is a screen rather than a document: the page it sits on stops
  // scrolling so the transcript can be the only scroller — see .agent-open,
  // and the note in AgentEmbed about what iOS does with a keyboard.
  useEffect(() => {
    document.documentElement.classList.toggle('agent-open', view === 'agent');
    return () => document.documentElement.classList.remove('agent-open');
  }, [view]);

  // With the assistant switched off there is nothing on this page at all, and
  // the front door is the landing. See AGENT_ENABLED, which is a decision
  // about what is finished rather than an environment variable.
  useEffect(() => {
    if (!AGENT_ENABLED) router.replace('/');
  }, [router]);

  /**
   * The conversation a /ai/c/<id> link names, opened once the chat is up.
   *
   * Read from the server rather than from this browser, so the same link opens
   * the same conversation on a phone. Still not shareable: the service answers
   * 404 for somebody else's id — a chat names positions and amounts, and the
   * privacy rule is that nothing identifying somebody reaches anybody else by
   * default. Following one that is not yours is a new chat, and the effect
   * below moves the URL to match.
   *
   * Keyed on the id rather than fired once, so a back or forward through two
   * conversations opens each of them rather than leaving the chat on whichever
   * was opened first.
   */
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !conversationId || opened.current === conversationId) return;
    opened.current = conversationId;
    // Already the one on screen — the usual case, when this page put the id in
    // the URL a moment ago. Re-opening it would be a wasted fetch.
    if (activeId === conversationId) return;
    awaitingOpen.current = true;
    agent.current?.openConversation(conversationId);
  }, [ready, conversationId, activeId]);

  /**
   * The address of the conversation on screen.
   *
   * Every chat has one from its first turn, the way every portfolio does,
   * rather than from a share button that mints one.
   *
   * `history.replaceState` rather than `router.replace`, and that is not a
   * detail. `/ai` and `/ai/c/<id>` are two route files rendering this same
   * screen, so a router navigation between them unmounts one page subtree and
   * mounts the other — which unmounts the chat, at the exact moment its first
   * answer arrives and gives it an address. The native call moves the address
   * bar without navigating, and Next patches it to keep `usePathname` in step,
   * so the URL becomes the conversation's without the conversation being
   * thrown away to say so. It is the same reason AgentEmbed revises the widget
   * in place instead of remounting it.
   *
   * Replace rather than push either way: which conversation is open is the
   * chat's state, not a stack of pages somebody walked through, and a history
   * entry per answer would make the back button undo a turn.
   */
  useEffect(() => {
    if (!ready) return;
    // Don't move the URL out from under a link that has not been opened yet,
    // or one that is still loading — see awaitingOpen.
    if (conversationId && opened.current !== conversationId) return;
    if (awaitingOpen.current) return;
    const target = activeId ? `/ai/c/${activeId}` : '/ai';
    if (pathname !== target) window.history.replaceState(null, '', target);
  }, [ready, activeId, conversationId, pathname]);

  /**
   * The chat asking for a sign-in — the card under the first answer.
   *
   * It dispatches rather than draws its own flow, because the account is this
   * app's: the modal, the providers and the token all live here. Signing in
   * does not restart the chat, which is the point of the whole exchange — see
   * AgentEmbed's update.
   */
  useEffect(() => {
    const open = () => setAuthOpen(true);
    window.addEventListener('svinooh:agent-signin', open);
    return () => window.removeEventListener('svinooh:agent-signin', open);
  }, []);

  const onTab = useCallback(
    (key: Tab) => {
      if (key === 'agent') {
        setView('agent');
        return;
      }
      // A portfolio exists: these are real pages, and the strip is navigation.
      if (slug) {
        router.push(key === 'portfolio' ? `/p/${slug}` : `/p/${slug}?${TAB_PARAM}=${key}`);
        return;
      }
      setView(key);
    },
    [router, slug],
  );

  const nothing = view === 'portfolio' || view === 'notifications' ? NOTHING_YET[view] : null;

  return (
    <div style={{ animation: 'svin .45s ease both' }}>
      <AppHeader
        tabs={tabs}
        active={view}
        onTab={(key: string) => onTab(key as Tab)}
        onLogo={() => router.push('/')}
        // The chat's own two actions, where a phone can reach them: there is
        // no rail below the breakpoint.
        tabActions={
          view === 'agent' ? (
            <>
              <button type="button" className="tab-action" aria-label="New chat" onClick={() => agent.current?.newChat()}>
                <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button type="button" className="tab-action" aria-label="History" onClick={() => agent.current?.openHistory()}>
                <svg viewBox="0 0 24 24" {...ICON} strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </button>
            </>
          ) : undefined
        }
        brandActions={
          <>
            <ThemeToggle />
            {me ? (
              <AccountMenu
                name={me.name}
                username={me.username}
                photoUrl={me.photoUrl}
                onPro={() => router.push('/pro')}
                onExit={() => {
                  logout();
                  router.push('/');
                }}
              />
            ) : (
              <Button size="sm" onClick={() => setAuthOpen(true)}>
                Sign in
              </Button>
            )}
          </>
        }
      />

      <div className="app-body">
        <SideNav
          tab={view}
          onTab={onTab}
          isAdmin={isAdmin}
          chat={
            view === 'agent'
              ? {
                  conversations,
                  onNew: () => agent.current?.newChat(),
                  onOpen: (id) => agent.current?.openConversation(id),
                }
              : undefined
          }
        />
        {/* No strip of pages to drag here: the chat is the page, and the other
            two are somewhere to go rather than something to swipe to. */}
        <div className="app-main">
          <div className="pane" data-tab={view} data-active="true" data-shown="true">
            {nothing ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0', textAlign: 'center' }}>
                <div>
                  <div style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-title)', letterSpacing: 'var(--tr-tight)' }}>
                    {nothing.title}
                  </div>
                  <p style={{ fontSize: 'var(--fs-body)', color: 'var(--mut)', margin: '8px 0 0' }}>{nothing.body}</p>
                  <Button size="sm" variant="soft" style={{ marginTop: 16 }} onClick={() => setView('agent')}>
                    Back to the agent
                  </Button>
                </div>
              </div>
            ) : (
              <AgentEmbed
                widgetUrl={AGENT_WIDGET_URL}
                agentUrl={AGENT_URL}
                slug={slug}
                token={token}
                portfolios={me?.portfolios}
                initialQuestion={known ? parked : undefined}
                onConversations={setConversations}
                onConversationId={onConversationId}
                control={agent}
              />
            )}
          </div>
        </div>
      </div>

      {authOpen ? <AuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
