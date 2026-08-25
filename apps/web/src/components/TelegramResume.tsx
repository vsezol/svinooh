import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';

/**
 * Добивает вход через Telegram при возврате на сайт. Срабатывает, когда
 * пользователь пришёл по кнопке из бота (`?tg_login=<token>`) или просто
 * перезагрузил вкладку с незавершённым входом (токен в sessionStorage).
 * Ничего не рендерит.
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

    // убираем tg_login из адреса, чтобы он не «прилипал» и не делился в ссылке
    if (urlToken) {
      params.delete('tg_login');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }

    if (me) {
      pendingTgToken.clear(); // уже вошли
      return;
    }

    started.current = true;
    return pollTelegramLogin(token, {
      onResult: (res) => {
        const authed = applyAuth(res);
        navigate(`/p/${authed.portfolioSlug}`);
      },
      onError: () => pendingTgToken.clear(),
    });
  }, [loading, me, applyAuth, navigate]);

  return null;
}
