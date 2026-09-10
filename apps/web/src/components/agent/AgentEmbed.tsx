'use client';

import { createInstance } from '@module-federation/runtime';
import { useEffect, useRef, useState } from 'react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';

/**
 * The agent chat, loaded from its own deployment at runtime.
 *
 * The chat is not part of this app: it is built, versioned and deployed with
 * the agent service, and arrives here as a Module Federation remote. This file
 * is the whole seam — everything the shell knows about the agent is the
 * `mount()` call below, so the chat can change entirely without a release
 * here.
 *
 * The host shares its React with the remote (singletons), which is the reason
 * to load through the federation runtime rather than a script tag: one React,
 * one renderer, one reconciler across the boundary. The remote also registers
 * a window global, so a script tag stays a working fallback if a bundler ever
 * fights the runtime — with its own React, which is exactly the trade the
 * federation path avoids.
 */

interface AgentMount {
  (
    el: HTMLElement,
    opts: {
      agentUrl: string;
      token?: string;
      portfolioSlug?: string;
      portfolios?: { slug: string; name: string }[];
      theme?: 'dark' | 'light';
      variant?: 'embedded' | 'standalone';
      signedIn?: boolean;
      /** Asked as soon as the chat is up, as if it had been typed. */
      initialQuestion?: string;
      onConversations?: (list: ConversationRef[]) => void;
      /** Which conversation is on screen, so the page can be its address. */
      onConversationId?: (id: string | null) => void;
    },
  ): AgentHandle;
}

/**
 * What mount() hands back. `update` arrived later than the rest, so it is
 * optional here: this app and the chat are separate deployments, and a host
 * that has shipped must keep working against a widget that has not.
 */
type AgentHandle = AgentControl & {
  unmount(): void;
  update?(opts: {
    token?: string;
    portfolioSlug?: string;
    portfolios?: { slug: string; name: string }[];
    signedIn?: boolean;
    initialQuestion?: string;
  }): void;
};

/**
 * One federation instance per page, created lazily.
 *
 * `lib: () => module` hands the remote this app's own React objects instead of
 * letting it resolve its bundled copies; `version` has to be stated because
 * the runtime has no package.json to read it from at this point.
 */
let instance: ReturnType<typeof createInstance> | null = null;

/**
 * A minute-stamp for the remote entry's URL.
 *
 * remoteEntry.js is the one file in the widget's build whose name cannot carry
 * a content hash — it is the name this file writes down, so it has to stay put
 * — and it is the file that names every hashed chunk. A browser holding an old
 * copy therefore runs an old chat, perfectly, out of cache, while the page
 * around it is new. Which is exactly what shipping a redesign looked like: a
 * new rail with the previous week's chat inside it.
 *
 * The widget's own nginx asks for sixty seconds. Cloudflare rewrites
 * Cache-Control on anything ending in .js to four hours and there is no header
 * the origin can send that wins that argument. A URL is different: caches key
 * on the whole of it, query included, so a stamp that changes every minute is
 * a sixty-second cache that actually holds — enforced from the side that can
 * enforce it.
 *
 * It costs one 7KB request a minute at worst. The chunks it names keep their
 * hashes and their year.
 */
const entryStamp = () => Math.floor(Date.now() / 60_000);

function federation(widgetUrl: string) {
  if (!instance) {
    const shareConfig = { singleton: true, requiredVersion: '^19.2.0' as const };
    instance = createInstance({
      name: 'svinooh_shell',
      remotes: [
        { name: 'svinooh_agent', entry: `${widgetUrl}/remoteEntry.js?t=${entryStamp()}` },
      ],
      shared: {
        react: { version: '19.2.0', lib: () => React, shareConfig },
        'react-dom': { version: '19.2.0', lib: () => ReactDOM, shareConfig },
        'react-dom/client': { version: '19.2.0', lib: () => ReactDOMClient, shareConfig },
      },
    });
  }
  return instance;
}

/**
 * Fetch the chat's code before anybody asks for it.
 *
 * The widget is the largest thing this page can load and it is behind a tab,
 * so it used to arrive when the tab did: you turned to the chat and watched it
 * appear. The federation runtime caches by module, so this is the same call
 * the mount makes — made early, and its result thrown away. The mount then
 * resolves from cache and the chat is on the strip before the turn ends.
 *
 * Safe to call repeatedly and safe to fail: a preload that does not arrive
 * leaves the mount to do exactly what it did before.
 */
export function preloadAgent(widgetUrl: string): void {
  void federation(widgetUrl)
    .loadRemote('svinooh_agent/mount')
    .catch(() => undefined);
}

interface Props {
  /** Where the remote entry is served from — the frontend deployment. */
  widgetUrl: string;
  /** Where questions go — the API deployment. */
  agentUrl: string;
  /**
   * The portfolio on the host's screen, when there is one. Absent on /ai for
   * somebody who has not made one yet — the chat answers without it, and can
   * make one for them.
   */
  slug?: string;
  token?: string;
  portfolios?: { slug: string; name: string | null }[];
  /**
   * The question the visitor typed somewhere else — the landing's composer —
   * asked the moment the chat is up.
   *
   * Asked once and only once, whatever happens to this component afterwards:
   * signing in swaps the token, which remounts the widget, and a question
   * re-asked there would be the same question twice in one conversation.
   */
  initialQuestion?: string;
  /** The chat's own conversations, for a host that draws them in its rail. */
  onConversations?: (list: ConversationRef[]) => void;
  /**
   * The conversation on screen, whenever it changes.
   *
   * A conversation is a server object now, so it has an address; this is how
   * the page learns which one it is showing. Null while a fresh chat has not
   * been spoken to — there is nothing at an address that does not exist yet.
   */
  onConversationId?: (id: string | null) => void;
  /** Filled in once the widget is up, so the rail can drive it. */
  control?: { current: AgentControl | null };
}

/** One conversation, as much as a rail needs to draw a row. */
export interface ConversationRef {
  id: string;
  title: string;
  at: number;
  active: boolean;
}

export interface AgentControl {
  newChat(): void;
  openConversation(id: string): void;
  /** Show the past conversations, for a surface with no rail to list them in. */
  openHistory(): void;
}

export function AgentEmbed({
  widgetUrl,
  agentUrl,
  slug,
  token,
  portfolios,
  initialQuestion,
  onConversations,
  onConversationId,
  control,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  /** Whether the handed-over question has already been put to the chat. */
  const asked = useRef(false);
  const handle = useRef<AgentHandle | null>(null);
  /**
   * Bumped only when the chat on the other side of the boundary is too old to
   * take a revision in place — then this is the old behaviour, a remount.
   */
  const [remounts, setRemounts] = useState(0);
  /**
   * What the mount should be given, read at the moment it happens.
   *
   * The load is async, so the values that were current when the effect ran are
   * not necessarily the ones that should go in — and putting them in the
   * effect's dependencies is what used to restart the chat every time one of
   * them arrived.
   */
  const latest = useRef({ token, slug, portfolios, initialQuestion });
  latest.current = { token, slug, portfolios, initialQuestion };

  // A chat is a column that scrolls inside itself. Left on a page that also
  // scrolls, iOS gives you both at once: the transcript drags the page behind
  // it, and focusing the composer makes Safari scroll the *page* to reveal it,
  // which is what puts the field in the middle of nowhere. So while this tab
  // is mounted — it is mounted only while it is the open tab — the page is not
  // a scroller at all.
  //
  // That is necessary and not sufficient, and the sufficient part is not
  // available. A keyboard on iOS does not shrink the page: the layout viewport
  // keeps its height, only the visible part gets smaller, and Safari slides
  // that window down to keep the focused field in it. Everything measured
  // against the page slides off the top with it.
  //
  // `interactive-widget=resizes-content` is the declarative answer and Safari
  // does not implement it. Measuring `visualViewport.height` and building the
  // chat to that is the usual workaround, and it was tried here and shipped
  // and was worse: the number arrives late on Safari, so the chat resized a
  // beat behind the keyboard and settled at a size that fitted neither state.
  // Same wall YouTube and VK hit, and they let the page move too.
  //
  // So the page is allowed to move. Safari lifts it to put the composer above
  // the keyboard and puts it back on blur, which is one whole movement that
  // reverses itself rather than a layout arguing with a measurement.
  // The page behind the chat stops scrolling while this is open, and that is
  // the page's own business rather than this component's -- see PortfolioPage,
  // which holds the lock still while the strip of tabs is moving. Setting it
  // on mount from here meant the ground was clipped to the window in the
  // middle of a page turn.

  useEffect(() => {
    // The load is async and the tab can close before it lands; mounting into a
    // detached node would leak a React root nothing ever unmounts.
    let cancelled = false;

    void (async () => {
      try {
        const mod = await federation(widgetUrl).loadRemote<{ mount: AgentMount }>(
          'svinooh_agent/mount',
        );
        if (cancelled || !host.current || !mod) return;
        const now = latest.current;
        const mounted = mod.mount(host.current, {
          agentUrl,
          token: now.token,
          portfolioSlug: now.slug,
          portfolios: now.portfolios?.map((p) => ({ slug: p.slug, name: p.name ?? p.slug })),
          // Theme is not passed: embedded, the chat draws on this page's own
          // custom properties, so it follows the header toggle with no prop to
          // keep in step. `theme` is for the standalone door.
          variant: 'embedded',
          signedIn: Boolean(now.token),
          initialQuestion: asked.current ? undefined : now.initialQuestion,
          onConversations,
          onConversationId,
        });
        asked.current = true;
        handle.current = mounted;
        // The rail drives the chat through this: New chat, and opening one of
        // the conversations it was just told about.
        if (control) control.current = mounted;
      } catch {
        // A remote that will not load is a tab that says so, not a blank pane
        // or a crashed page.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (control) control.current = null;
      handle.current?.unmount();
      handle.current = null;
    };
    // Once per chat. What the caller may see — the token, the portfolio — is
    // revised in place below rather than by starting over, because starting
    // over throws away the conversation on screen. Which is exactly what
    // happened at the worst moment: the product asks somebody to sign in under
    // their first answer, and signing in swapped the token.
  }, [widgetUrl, agentUrl, onConversations, onConversationId, control, remounts]);

  /**
   * Keep the running chat in step with who is asking and what they are looking
   * at.
   *
   * A widget old enough not to have `update` gets the old treatment — a
   * remount — because the two are deployed separately and the alternative is a
   * chat answering with a token it no longer has.
   */
  useEffect(() => {
    const live = handle.current;
    if (!live) return;
    if (typeof live.update !== 'function') {
      setRemounts((n) => n + 1);
      return;
    }
    live.update({
      token,
      portfolioSlug: slug,
      portfolios: portfolios?.map((p) => ({ slug: p.slug, name: p.name ?? p.slug })),
      signedIn: Boolean(token),
      // The handed-over question comes this way too, because it is held back
      // until the host knows who is asking — and that is usually a moment
      // after the chat is already on screen. The chat asks it once, whichever
      // way it arrives.
      initialQuestion,
    });
  }, [token, slug, portfolios, initialQuestion]);

  if (failed) {
    return (
      <div className="agent-embed-note mono">
        The agent could not be loaded right now. Reload the page to try again.
      </div>
    );
  }
  return <div className="agent-embed" ref={host} />;
}
