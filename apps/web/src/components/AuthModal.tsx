import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TelegramStartDto } from '@svinooh/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';
import { Logo } from './Logo';
import { Modal } from './Modal';

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

const TG_ICON = (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="#2AABEE">
    <path d="M21.9 4.1c.3-1.1-.8-2-1.8-1.6L2.7 9.3c-1.1.4-1 2 .1 2.3l4.6 1.4 1.7 5.4c.3 1 1.6 1.3 2.3.5l2.4-2.7 4.5 3.3c.9.6 2.1.1 2.3-1l3.3-14.4zM9.2 13.5l8.7-5.5-6.8 6.6-.2 2.6-1.7-3.7z" />
  </svg>
);

/**
 * `notice` — why the modal opened by itself rather than because the visitor
 * pressed something. An expired sign-in link is the case it exists for: landing
 * signed out with no explanation is how people conclude the thing is broken.
 */
export function AuthModal({ onClose, notice }: { onClose: () => void; notice?: string }) {
  const { config, loginDev, applyAuth } = useAuth();
  const router = useRouter();
  const [devName, setDevName] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [deepLink, setDeepLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopPoll.current?.();
    };
  }, []);

  const startTelegram = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<TelegramStartDto>('/auth/telegram/start', { method: 'POST' });
      setDeepLink(s.deepLink);
      pendingTgToken.set(s.token);
      window.open(s.deepLink, '_blank', 'noopener');
      setWaiting(true);
      stopPoll.current = pollTelegramLogin(s.token, {
        onResult: (res) => {
          void applyAuth(res).then((authed) => {
            onClose();
            router.push(`/p/${authed.portfolioSlug}`);
          });
        },
        onError: (message) => {
          setWaiting(false);
          setError(message);
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start sign-in");
    } finally {
      setBusy(false);
    }
  };

  const submitDev = async (event: FormEvent) => {
    event.preventDefault();
    if (!devName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const authed = await loginDev(devName.trim());
      onClose();
      router.push(`/p/${authed.portfolioSlug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div
        style={{ background: 'var(--surf)', border: '1px solid var(--line2)', borderRadius: 20, padding: '28px 24px', position: 'relative' }}
      >
        <div onClick={onClose} className="auth-close" style={{ position: 'absolute', top: 12, right: 14, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mut)', fontSize: 16, cursor: 'pointer' }}>
          ×
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo size={22} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, textAlign: 'center', marginTop: 14 }}>
          {notice ? 'Sign in again' : 'Create your portfolio'}
        </div>
        {notice ? (
          <div
            style={{
              marginTop: 14,
              border: '1px solid color-mix(in srgb, var(--down) 38%, transparent)',
              background: 'color-mix(in srgb, var(--down) 9%, transparent)',
              borderRadius: 12,
              padding: '11px 13px',
              fontSize: 12.5,
              lineHeight: 1.55,
              textAlign: 'center',
            }}
          >
            {notice}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--mut)', textAlign: 'center', marginTop: 6, lineHeight: 1.55 }}>
            Sign in to add wallets and get your public link. Viewing portfolios never needs an account.
          </div>
        )}

        {waiting ? (
          <div style={{ marginTop: 22, textAlign: 'center' }}>
            <span className="spin" style={{ width: 22, height: 22 }} />
            <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 700 }}>Opening Telegram…</div>
            <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.55 }}>
              Tap <b>Start</b> in the bot and come back — you'll be signed in automatically.
            </div>
            <a href={deepLink} target="_blank" rel="noopener noreferrer" className="mono" style={{ display: 'inline-block', marginTop: 14, fontSize: 11.5, color: 'var(--acc-text)' }}>
              Telegram didn't open? Open again →
            </a>
          </div>
        ) : (
          <>
            {config?.botUsername ? (
              <button className="auth-btn" style={{ ...modalBtn, marginTop: 20 }} onClick={startTelegram} disabled={busy}>
                {busy ? <span className="spin" style={{ width: 15, height: 15 }} /> : (<>{TG_ICON}Continue with Telegram</>)}
              </button>
            ) : null}

            {config?.devMode ? (
              <form onSubmit={submitDev} style={{ marginTop: config?.botUsername ? 12 : 20 }}>
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

            {!config?.botUsername && !config?.devMode ? (
              <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--mut)', textAlign: 'center' }}>
                Telegram sign-in is not configured on the server.
              </div>
            ) : null}
          </>
        )}

        {error ? <div style={{ marginTop: 12, fontSize: 12, color: 'var(--down)', textAlign: 'center' }}>{error}</div> : null}
      </div>
    </Modal>
  );
}
