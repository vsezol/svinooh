import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthResponseDto } from '@svinooh/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';
import { AuthModal } from './AuthModal';

/** Take a token out of the URL without leaving it in history or in a shared link */
function takeParam(name: string): string | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  if (value === null) return null;
  params.delete(name);
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  return value;
}

/**
 * Signs the visitor in when they arrive from Telegram.
 *
 * Two ways in, and they are not the same thing:
 *
 *  - `?login=<key>` — the standalone link the bot sends into the chat. It works
 *    in Telegram's browser, on a second device, in a tab opened later, and it
 *    signs you in whoever you were before.
 *  - `?tg_login=` / a token in sessionStorage — a sign-in the site itself
 *    started and is still waiting on. Only useful if nobody is signed in yet.
 *
 * A link that has run out says so. Landing signed out with no explanation is
 * how someone decides the product is broken and leaves; the sign-in modal opens
 * with the reason and the one-press way to get a fresh link.
 */
export function TelegramResume() {
  const { me, loading, applyAuth } = useAuth();
  const router = useRouter();
  const started = useRef(false);
  const [deadLink, setDeadLink] = useState<string | null>(null);

  useEffect(() => {
    if (loading || started.current) return;

    const key = takeParam('login');
    if (key) {
      started.current = true;
      void api<AuthResponseDto>('/auth/link', { method: 'POST', body: JSON.stringify({ token: key }) })
        .then((res) => applyAuth(res, 'telegram'))
        .then((authed) => {
          // The link already points at the portfolio; only send them there if
          // it doesn't
          if (window.location.pathname === '/') router.push(`/p/${authed.portfolioSlug}`);
        })
        .catch((err: unknown) => {
          started.current = false;
          // Already signed in: the link had nothing to add, so its expiry is
          // not news — the page in front of them works
          if (me) return;
          setDeadLink(
            err instanceof ApiError && err.statusCode === 401
              ? err.message
              : 'That sign-in link could not be used. Open the bot and press Start for a new one.',
          );
        });
      return;
    }

    const urlToken = takeParam('tg_login');
    const token = urlToken || pendingTgToken.get();
    if (!token) return;

    if (me) {
      pendingTgToken.clear(); // already signed in
      return;
    }

    started.current = true;
    return pollTelegramLogin(token, {
      onResult: (res) => {
        void applyAuth(res, 'telegram').then((authed) => router.push(`/p/${authed.portfolioSlug}`));
      },
      onError: () => pendingTgToken.clear(),
    });
  }, [loading, me, applyAuth, router]);

  return deadLink ? <AuthModal notice={deadLink} onClose={() => setDeadLink(null)} /> : null;
}
