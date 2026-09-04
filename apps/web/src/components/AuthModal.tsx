import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TelegramStartDto } from '@svinooh/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';
import { Button, Dialog, IconButton, Input, Note, Spinner, Title } from '../ui';
import { Logo } from './Logo';

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

  const heading = notice ? 'Sign in again' : 'Create your portfolio';

  return (
    <Dialog onClose={onClose} title={heading}>
      <IconButton
        label="Close"
        variant="bare"
        size="xs"
        onClick={onClose}
        style={{ position: 'absolute', top: 'var(--sp-5)', right: 14, fontSize: 'var(--fs-lead)' }}
      >
        ×
      </IconButton>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Logo size={22} />
      </div>
      <Title style={{ textAlign: 'center', marginTop: 14 }}>{heading}</Title>
      {notice ? (
        <div
          style={{
            marginTop: 14,
            border: '1px solid color-mix(in srgb, var(--down) 38%, transparent)',
            background: 'color-mix(in srgb, var(--down) 9%, transparent)',
            borderRadius: 'var(--r-md)',
            padding: '11px 13px',
            fontSize: 'var(--fs-note)',
            lineHeight: 1.55,
            textAlign: 'center',
          }}
        >
          {notice}
        </div>
      ) : (
        <Note style={{ textAlign: 'center', marginTop: 'var(--sp-3)', lineHeight: 1.55 }}>
          Sign in to add wallets and get your public link. Viewing portfolios never needs an account.
        </Note>
      )}

      {waiting ? (
        <div style={{ marginTop: 22, textAlign: 'center' }}>
          <Spinner size={22} />
          <div style={{ marginTop: 14, fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)' }}>
            Opening Telegram…
          </div>
          <Note style={{ marginTop: 'var(--sp-3)', lineHeight: 1.55 }}>
            Tap <b>Start</b> in the bot and come back — you'll be signed in automatically.
          </Note>
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{ display: 'inline-block', marginTop: 14, fontSize: 'var(--fs-note)', color: 'var(--acc-text)' }}
          >
            Telegram didn't open? Open again →
          </a>
        </div>
      ) : (
        <>
          {config?.botUsername ? (
            <Button
              variant="soft"
              size="lg"
              block
              loading={busy}
              onClick={startTelegram}
              style={{ marginTop: 'var(--sp-6)' }}
            >
              {TG_ICON}
              Continue with Telegram
            </Button>
          ) : null}

          {config?.devMode ? (
            <form onSubmit={submitDev} style={{ marginTop: config?.botUsername ? 'var(--sp-5)' : 'var(--sp-6)' }}>
              <Input
                mono
                value={devName}
                onChange={(e) => {
                  setDevName(e.target.value);
                  setError(null);
                }}
                placeholder="dev sign-in · your name"
                aria-label="Your name"
              />
              <Button type="submit" variant="soft" size="lg" block loading={busy} style={{ marginTop: 'var(--sp-4)' }}>
                Continue as dev
              </Button>
            </form>
          ) : null}

          <Button variant="soft" size="lg" block disabled style={{ marginTop: 'var(--sp-4)' }}>
            <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor">
              <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2h6.4l4.4 5.9L18.9 2zm-1.1 18h1.7L6.9 3.7H5.1L17.8 20z" />
            </svg>
            Continue with X · soon
          </Button>

          {!config?.botUsername && !config?.devMode ? (
            <div
              className="mono"
              style={{ marginTop: 'var(--sp-6)', fontSize: 'var(--fs-tag)', color: 'var(--mut)', textAlign: 'center' }}
            >
              Telegram sign-in is not configured on the server.
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <div
          style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--fs-note)', color: 'var(--down)', textAlign: 'center' }}
        >
          {error}
        </div>
      ) : null}
    </Dialog>
  );
}
