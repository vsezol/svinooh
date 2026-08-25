import { useEffect, useRef } from 'react';
import type { TelegramAuthPayload } from '@svinooh/shared';
import { useAuth } from '../lib/auth';

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

/**
 * Официальный Telegram Login Widget. Требует, чтобы домен страницы был
 * привязан к боту через /setdomain у @BotFather — на localhost кнопка
 * работать не будет, для локальной разработки есть dev-вход.
 */
export function TelegramLogin({
  botUsername,
  onDone,
}: {
  botUsername: string;
  onDone?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { loginTelegram } = useAuth();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    window.onTelegramAuth = (user) => {
      void loginTelegram(user)
        .then(() => onDone?.())
        .catch((error) => {
          alert(`Sign-in failed: ${error instanceof Error ? error.message : error}`);
        });
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '14');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      delete window.onTelegramAuth;
    };
  }, [botUsername, loginTelegram, onDone]);

  return <div ref={containerRef} />;
}
