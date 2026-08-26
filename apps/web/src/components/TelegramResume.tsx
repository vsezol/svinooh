import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthResponseDto } from '@svinooh/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';

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
 * Signs the visitor in when they arrive from Telegram. Renders nothing.
 *
 * Two ways in, and they are not the same thing:
 *
 *  - `?login=<key>` — the durable link the bot sends into the chat. It stands on
 *    its own, so it works in Telegram's browser, on a second device, an hour
 *    later, and it signs you in whoever you were before.
 *  - `?tg_login=` / a token in sessionStorage — a sign-in the site itself
 *    started and is still waiting on. Only useful if nobody is signed in yet.
 */
export function TelegramResume() {
  const { me, loading, applyAuth } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;

    const key = takeParam('login');
    if (key) {
      started.current = true;
      void api<AuthResponseDto>('/auth/link', { method: 'POST', body: JSON.stringify({ token: key }) })
        .then((res) => applyAuth(res))
        .then((authed) => {
          // The link already points at the portfolio; only send them there if
          // it doesn't
          if (window.location.pathname === '/') navigate(`/p/${authed.portfolioSlug}`);
        })
        .catch(() => {
          // Expired or already spent — leave them where they are rather than
          // interrupting with an error they can do nothing about
          started.current = false;
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
        void applyAuth(res).then((authed) => navigate(`/p/${authed.portfolioSlug}`));
      },
      onError: () => pendingTgToken.clear(),
    });
  }, [loading, me, applyAuth, navigate]);

  return null;
}
