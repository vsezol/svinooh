'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AuthResponseDto } from '@svinooh/shared';
import { Logo } from '../../../../src/components/Logo';
import { api, ApiError } from '../../../../src/lib/api';
import { useAuth } from '../../../../src/lib/auth';
import { Button, Note, Spinner } from '../../../../src/ui';

/**
 * Where X sends the browser back to.
 *
 * The page has one job: hand the code and state to the server, take the
 * session it answers with, and leave. It goes through the same applyAuth
 * funnel every sign-in does, so a portfolio the visitor set out to claim
 * before the detour is claimed on the way past — the intent sat in
 * sessionStorage, and a redirect within the tab keeps sessionStorage.
 *
 * Denying consent brings the browser here too, with an `error` instead of a
 * code. That is an answer, not a failure — it reads as "sign-in cancelled" and
 * offers the way back, rather than a red box about a thing they chose.
 */
function XCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const { applyAuth } = useAuth();
  const [failed, setFailed] = useState<string | null>(null);
  // Strict mode mounts twice in development, and the code is single-use:
  // the second exchange would kill the first one's session
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setFailed(params.get('error') === 'access_denied' ? 'Sign-in cancelled.' : 'Sign-in did not complete.');
      return;
    }
    void api<AuthResponseDto>('/auth/x/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    })
      .then(applyAuth)
      .then((me) => router.replace(`/p/${me.portfolioSlug}`))
      .catch((err) => {
        setFailed(err instanceof ApiError ? err.message : 'Sign-in did not complete.');
      });
    // Once, with whatever the URL arrived holding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <Logo size={22} />
      {failed ? (
        <>
          <Note style={{ lineHeight: 1.55 }}>{failed}</Note>
          <Button variant="soft" onClick={() => router.replace('/')}>
            Back to svinooh
          </Button>
        </>
      ) : (
        <>
          <Spinner size={22} />
          <Note>Signing you in with X…</Note>
        </>
      )}
    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary above it during prerender
  return (
    <Suspense fallback={null}>
      <XCallback />
    </Suspense>
  );
}
