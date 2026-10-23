'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthModal } from '../../src/components/AuthModal';
import { Logo } from '../../src/components/Logo';
import { tokenStore } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { Button, Card, Note, Spinner, Title } from '../../src/ui';

const MCP_URL = (process.env.NEXT_PUBLIC_MCP_URL || '').replace(/\/+$/, '');

interface Asking {
  client: string;
  redirect: string;
}

/**
 * Where an MCP client — Claude, or anything else that speaks to apps/mcp —
 * sends the browser to be let in.
 *
 * The question is put here, on svinooh.com, because this is where the person
 * is signed in: the answer carries their session to the MCP server, which
 * keeps it and gives the client a token of its own. The page names the client
 * and, as plainly, where the browser goes next — the one line that tells a
 * real request from a link somebody sent to borrow their account.
 */
function Connect() {
  const params = useSearchParams();
  const request = params.get('request') ?? '';
  const { me, loading } = useAuth();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'approve' | 'deny'>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!request || !MCP_URL) {
      setFailed('This link is incomplete. Start connecting again from the app that sent you here.');
      return;
    }
    fetch(`${MCP_URL}/oauth/requests/${encodeURIComponent(request)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('expired');
        setAsking((await res.json()) as Asking);
      })
      .catch(() => setFailed('This request has expired or was already answered. Start connecting again.'));
  }, [request]);

  const answer = async (choice: 'approve' | 'deny') => {
    setBusy(choice);
    try {
      const token = tokenStore.get();
      const res = await fetch(`${MCP_URL}/oauth/requests/${encodeURIComponent(request)}/${choice}`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const { redirect } = (await res.json()) as { redirect: string };
      window.location.assign(redirect);
    } catch {
      setBusy(null);
      setFailed('That did not go through. Start connecting again from the app that sent you here.');
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--sp-7)',
        padding: 'var(--sp-7)',
      }}
    >
      <Logo size={22} />
      {failed ? (
        <Note style={{ textAlign: 'center', maxWidth: 420 }}>{failed}</Note>
      ) : !asking || loading ? (
        <Spinner size={22} />
      ) : (
        <Card
          style={{
            maxWidth: 440,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-6)',
            padding: 'var(--sp-7)',
          }}
        >
          <Title>Connect {asking.client} to svinooh</Title>
          <Note>
            {asking.client} will be able to read your portfolios: totals, positions, history and the rates on
            offer, private portfolios included. It cannot move money or change anything.
          </Note>
          <Note>
            After you answer, you go back to <strong>{asking.redirect}</strong>. If that is not where you
            started connecting, deny.
          </Note>
          {me ? (
            <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
              <Button
                block
                loading={busy === 'approve'}
                disabled={busy !== null}
                onClick={() => void answer('approve')}
              >
                Allow
              </Button>
              <Button
                block
                variant="soft"
                loading={busy === 'deny'}
                disabled={busy !== null}
                onClick={() => void answer('deny')}
              >
                Deny
              </Button>
            </div>
          ) : (
            <Button block onClick={() => setSigningIn(true)}>
              Sign in to continue
            </Button>
          )}
        </Card>
      )}
      {signingIn ? (
        <AuthModal
          onClose={() => setSigningIn(false)}
          returnTo={`/connect?request=${encodeURIComponent(request)}`}
        />
      ) : null}
    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary above it during prerender
  return (
    <Suspense fallback={null}>
      <Connect />
    </Suspense>
  );
}
