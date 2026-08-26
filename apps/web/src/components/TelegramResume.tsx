import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';

/**
 * Completes the Telegram sign-in when the user returns to the site. Fires when
 * the user arrives via the bot's button (`?tg_login=<token>`) or simply
 * reloads a tab with an unfinished sign-in (token in sessionStorage).
 * Renders nothing.
 */
export function TelegramResume() {
  const { me, loading, applyAuth } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;

    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('tg_login');
    const token = urlToken || pendingTgToken.get();
    if (!token) return;

    // strip tg_login from the URL so it doesn't linger or get shared in a link
    if (urlToken) {
      params.delete('tg_login');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }

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
