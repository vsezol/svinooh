'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import type { DepositOutcome, DepositRequest } from '../../lib/deposit';
import type { ConversationRef, PortfolioRef } from '../../agent/app/types';

/**
 * The agent chat, as a component of this app.
 *
 * It used to be its own deployment, loaded here at runtime as a Module
 * Federation remote behind a `mount()` contract. It is plain React now, under
 * src/agent, and this file is what is left of the seam: it maps the host's
 * idea of the chat (a slug, a token, a list of portfolios) onto the chat's
 * props, and hands the host a handle to drive it from the rail.
 *
 * Loaded on demand and never on the server: the chat is the largest thing a
 * portfolio page can show and it sits behind a tab, so its code stays out of
 * the page's own chunk and arrives when preloadAgent asks or the tab opens.
 */
const App = dynamic(() => import('../../agent/app/App').then((m) => m.App), { ssr: false });

/**
 * Fetch the chat's code before anybody asks for it — the same import the
 * component makes, made early. Safe to call repeatedly and safe to fail.
 */
export function preloadAgent(): void {
  void import('../../agent/app/App').catch(() => undefined);
}

export type { ConversationRef };

export interface AgentControl {
  newChat(): void;
  openConversation(id: string): void;
  /** Show the past conversations, for a surface with no rail to list them in. */
  openHistory(): void;
}

interface Props {
  /** Where questions go — the agent service. */
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
   * asked the moment the chat is up. The chat asks it once per mount, and
   * nothing here remounts it: a token arriving after sign-in is a new prop,
   * not a new chat.
   */
  initialQuestion?: string;
  /** The chat's own conversations, for a host that draws them in its rail. */
  onConversations?: (list: ConversationRef[]) => void;
  /** The conversation on screen, so the page can be its address. */
  onConversationId?: (id: string | null) => void;
  onDeposit?: (request: DepositRequest) => Promise<DepositOutcome>;
  /** Filled in once the chat is up, so the rail can drive it. */
  control?: { current: AgentControl | null };
}

export function AgentEmbed({
  agentUrl,
  slug,
  token,
  portfolios,
  initialQuestion,
  onConversations,
  onConversationId,
  onDeposit,
  control,
}: Props) {
  // The chat fills this box on its first render — the actions do not exist
  // before React has drawn it — and the host reads them through `control`.
  const box = useMemo<AgentControl>(
    () => ({ newChat: () => undefined, openConversation: () => undefined, openHistory: () => undefined }),
    [],
  );
  useEffect(() => {
    if (!control) return;
    control.current = box;
    return () => {
      control.current = null;
    };
  }, [control, box]);

  const named: PortfolioRef[] | undefined = portfolios?.map((p) => ({
    slug: p.slug,
    name: p.name ?? p.slug,
  }));

  return (
    <div className="agent-embed">
      <App
        agentUrl={agentUrl}
        token={token}
        portfolioSlug={slug}
        portfolios={named}
        // Theme is not passed: embedded, the chat draws on this page's own
        // custom properties, so it follows the header toggle with no prop to
        // keep in step.
        variant="embedded"
        signedIn={Boolean(token)}
        initialQuestion={initialQuestion}
        onConversations={onConversations}
        onConversationId={onConversationId}
        onDeposit={onDeposit}
        control={box}
      />
    </div>
  );
}
