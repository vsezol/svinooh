import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { TelegramAuthPayload } from '@svinooh/shared';
import { useAuth } from '../lib/auth';
import { Logo } from './Logo';

declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth: (
          opts: { bot_id: string; request_access?: string; lang?: string },
          callback: (user: TelegramAuthPayload | false) => void,
        ) => void;
      };
    };
  }
}

const modalBtn: CSSProperties = {
  marginTop: 8,
  background: 'var(--surf2)',
  border: '1px solid var(--line2)',
  color: 'var(--text)',
  fontWeight: 800,
  fontSize: 13.5,
  borderRadius: 999,
  height: 46,
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 9,
  cursor: 'pointer',
  userSelect: 'none',
};

export function AuthModal({ onClose }: { onClose: () => void }) {
  const { config, loginTelegram, loginDev } = useAuth();
  const [devName, setDevName] = useState('');
  const [busy, setBusy] = useState(false);
  const [tgReady, setTgReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Грузим telegram-widget.js один раз — он определяет window.Telegram.Login.auth,
  // который открывает попап авторизации по клику нашей СВОЕЙ кнопки
  useEffect(() => {
    if (!config?.botId) return;
    if (window.Telegram?.Login) {
      setTgReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.onload = () => setTgReady(true);
    document.head.appendChild(script);
  }, [config?.botId]);

  const loginTg = () => {
    if (!config?.botId || !window.Telegram?.Login || busy) return;
    setError(null);
    setBusy(true);
    window.Telegram.Login.auth({ bot_id: config.botId, request_access: 'write' }, (user) => {
      if (!user) {
        setBusy(false);
        return; // пользователь закрыл окно
      }
      void loginTelegram(user)
        .then(() => onClose())
        .catch((e) => {
          setError(e instanceof Error ? e.message : 'Sign-in failed');
          setBusy(false);
        });
    });
  };

  const submitDev = async (event: FormEvent) => {
    event.preventDefault();
    if (!devName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginDev(devName.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'color-mix(in srgb, var(--bg) 65%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--surf)',
          border: '1px solid var(--line2)',
          borderRadius: 20,
          padding: '28px 24px',
          position: 'relative',
        }}
      >
        <div onClick={onClose} className="auth-close" style={{ position: 'absolute', top: 12, right: 14, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mut)', fontSize: 16, cursor: 'pointer' }}>
          ×
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo size={22} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, textAlign: 'center', marginTop: 14 }}>Create your portfolio</div>
        <div style={{ fontSize: 12.5, color: 'var(--mut)', textAlign: 'center', marginTop: 6, lineHeight: 1.55 }}>
          Sign in to add wallets and get your public link. Viewing portfolios never needs an account.
        </div>

        {config?.botId ? (
          <button className="auth-btn" style={{ ...modalBtn, marginTop: 20 }} onClick={loginTg} disabled={!tgReady || busy}>
            {busy ? (
              <span className="spin" style={{ width: 15, height: 15 }} />
            ) : (
              <>
                <svg viewBox="0 0 24 24" width={16} height={16} fill="#2AABEE">
                  <path d="M21.9 4.1c.3-1.1-.8-2-1.8-1.6L2.7 9.3c-1.1.4-1 2 .1 2.3l4.6 1.4 1.7 5.4c.3 1 1.6 1.3 2.3.5l2.4-2.7 4.5 3.3c.9.6 2.1.1 2.3-1l3.3-14.4zM9.2 13.5l8.7-5.5-6.8 6.6-.2 2.6-1.7-3.7z" />
                </svg>
                Continue with Telegram
              </>
            )}
          </button>
        ) : null}

        {config?.devMode ? (
          <form onSubmit={submitDev} style={{ marginTop: config?.botId ? 12 : 20 }}>
            <input
              className="mono"
              value={devName}
              onChange={(e) => {
                setDevName(e.target.value);
                setError(null);
              }}
              placeholder="dev sign-in · your name"
              style={{ width: '100%', height: 44, background: 'var(--surf2)', border: '1px solid var(--line2)', borderRadius: 999, padding: '0 16px', fontSize: 13, color: 'var(--text)', outline: 'none' }}
            />
            <button type="submit" className="auth-btn" style={modalBtn} disabled={busy}>
              {busy ? <span className="spin" style={{ width: 14, height: 14 }} /> : 'Continue as dev'}
            </button>
          </form>
        ) : null}

        <div className="auth-btn" title="Coming soon" style={{ ...modalBtn, opacity: 0.5, cursor: 'not-allowed' }}>
          <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor">
            <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2h6.4l4.4 5.9L18.9 2zm-1.1 18h1.7L6.9 3.7H5.1L17.8 20z" />
          </svg>
          Continue with X · soon
        </div>

        {!config?.botId && !config?.devMode ? (
          <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--mut)', textAlign: 'center' }}>
            Telegram sign-in is not configured on the server.
          </div>
        ) : null}
        {error ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--down)', textAlign: 'center' }}>{error}</div>
        ) : null}
      </div>
    </div>
  );
}
