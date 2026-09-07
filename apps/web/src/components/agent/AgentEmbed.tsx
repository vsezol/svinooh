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

function federation(agentUrl: string) {
  if (!instance) {
    const shareConfig = { singleton: true, requiredVersion: '^19.2.0' as const };
    instance = createInstance({
      name: 'svinooh_shell',
      remotes: [{ name: 'svinooh_agent', entry: `${agentUrl}/widget/remoteEntry.js` }],
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
  agentUrl: string;
  slug: string;
  token?: string;
  portfolios?: { slug: string; name: string | null }[];
}

export function AgentEmbed({ agentUrl, slug, token, portfolios }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let handle: { unmount(): void } | null = null;
    // The load is async and the tab can close before it lands; mounting into a
    // detached node would leak a React root nothing ever unmounts.
    let cancelled = false;

    void (async () => {
      try {
        const mod = await federation(agentUrl).loadRemote<{ mount: AgentMount }>(
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
  }, [agentUrl, slug, token, portfolios]);

  if (failed) {
    return (
      <div className="agent-embed-note mono">
        The agent could not be loaded right now. Reload the page to try again.
      </div>
    );
  }
  return <div className="agent-embed" ref={host} />;
}
