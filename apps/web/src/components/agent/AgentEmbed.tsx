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
    },
  ): { unmount(): void };
}

/**
 * One federation instance per page, created lazily.
 *
 * `lib: () => module` hands the remote this app's own React objects instead of
 * letting it resolve its bundled copies; `version` has to be stated because
 * the runtime has no package.json to read it from at this point.
 */
let instance: ReturnType<typeof createInstance> | null = null;

function federation(widgetUrl: string) {
  if (!instance) {
    const shareConfig = { singleton: true, requiredVersion: '^19.2.0' as const };
    instance = createInstance({
      name: 'svinooh_shell',
      remotes: [{ name: 'svinooh_agent', entry: `${widgetUrl}/remoteEntry.js` }],
      shared: {
        react: { version: '19.2.0', lib: () => React, shareConfig },
        'react-dom': { version: '19.2.0', lib: () => ReactDOM, shareConfig },
        'react-dom/client': { version: '19.2.0', lib: () => ReactDOMClient, shareConfig },
      },
    });
  }
  return instance;
}

interface Props {
  /** Where the remote entry is served from — the frontend deployment. */
  widgetUrl: string;
  /** Where questions go — the API deployment. */
  agentUrl: string;
  slug: string;
  token?: string;
  portfolios?: { slug: string; name: string | null }[];
}

export function AgentEmbed({ widgetUrl, agentUrl, slug, token, portfolios }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

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
  // chat to that is the usual workaround, and it was tried here and made
  // things worse: the number arrives late on Safari, so the chat resizes a
  // beat after the keyboard and lands somewhere neither size fits. Same reason
  // YouTube and VK let the page move.
  //
  // So the page is allowed to move, and only kept from scrolling twice. Safari
  // lifts it to put the composer above the keyboard and puts it back on blur,
  // which is at least a whole movement that reverses itself.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('agent-open');
    return () => root.classList.remove('agent-open');
  }, []);

  useEffect(() => {
    let handle: { unmount(): void } | null = null;
    // The load is async and the tab can close before it lands; mounting into a
    // detached node would leak a React root nothing ever unmounts.
    let cancelled = false;

    void (async () => {
      try {
        const mod = await federation(widgetUrl).loadRemote<{ mount: AgentMount }>(
          'svinooh_agent/mount',
        );
        if (cancelled || !host.current || !mod) return;
        handle = mod.mount(host.current, {
          agentUrl,
          token,
          portfolioSlug: slug,
          portfolios: portfolios?.map((p) => ({ slug: p.slug, name: p.name ?? p.slug })),
          // Theme is not passed: embedded, the chat draws on this page's own
          // custom properties, so it follows the header toggle with no prop to
          // keep in step. `theme` is for the standalone door.
          variant: 'embedded',
          signedIn: Boolean(token),
        });
      } catch {
        // A remote that will not load is a tab that says so, not a blank pane
        // or a crashed page.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      handle?.unmount();
    };
    // Remounting on a token or portfolio change is the point: both decide what
    // the chat is allowed to see, and the mount contract has no way to revise
    // them in place.
  }, [widgetUrl, agentUrl, slug, token, portfolios]);

  if (failed) {
    return (
      <div className="agent-embed-note mono">
        The agent could not be loaded right now. Reload the page to try again.
      </div>
    );
  }
  return <div className="agent-embed" ref={host} />;
}
