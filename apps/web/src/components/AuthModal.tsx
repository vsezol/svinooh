import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TelegramStartDto, XStartDto } from '@svinooh/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { parkReturn } from '../lib/after-signin';
import { pendingTgToken, pollTelegramLogin } from '../lib/telegram';
import {
  connectWalletConnect,
  declined,
  endWalletSession,
  signInWithWallet,
  useBrowserWallets,
  type WalletProvider,
} from '../lib/wallet';
import { Button, Dialog, IconButton, Input, Note, Spinner, Title } from '../ui';
import { XMark } from '@svinooh/ui';
import { Logo } from './Logo';

const TG_ICON = (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="#2AABEE">
    <path d="M21.9 4.1c.3-1.1-.8-2-1.8-1.6L2.7 9.3c-1.1.4-1 2 .1 2.3l4.6 1.4 1.7 5.4c.3 1 1.6 1.3 2.3.5l2.4-2.7 4.5 3.3c.9.6 2.1.1 2.3-1l3.3-14.4zM9.2 13.5l8.7-5.5-6.8 6.6-.2 2.6-1.7-3.7z" />
  </svg>
);

const WALLET_ICON = (
  <svg
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M4 8.4V6.8A1.8 1.8 0 0 1 5.8 5h10.4" />
    <rect x="3" y="8.4" width="18" height="10.6" rx="2.4" />
    <path d="M21 12.3h-3.5a1.8 1.8 0 0 0 0 3.6H21" />
  </svg>
);

/** A QR square: what choosing WalletConnect on a desktop actually produces */
const QR_ICON = (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
    <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
    <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
    <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
    <path d="M14 14h3v3h-3zM20.5 14v3M17.5 20.5h3" strokeLinecap="round" />
  </svg>
);

/**
 * `notice` — why the modal opened by itself rather than because the visitor
 * pressed something. An expired sign-in link is the case it exists for: landing
 * signed out with no explanation is how people conclude the thing is broken.
 *
 * `returnTo` — where the visitor already is, when leaving would lose something.
 * Absent, a completed sign-in goes to the new account's portfolio, which is
 * what the landing wants. The chat passes its own address instead: it asks for
 * an account underneath a first answer, and taking somebody away from the
 * conversation at that exact moment is taking away the thing they signed in
 * to keep.
 */
export function AuthModal({
  onClose,
  notice,
  returnTo,
}: {
  onClose: () => void;
  notice?: string;
  returnTo?: string;
}) {
  const { config, loginDev, applyAuth } = useAuth();
  const router = useRouter();
  const [devName, setDevName] = useState('');
  /**
   * Which sign-in is in flight — the spinner belongs to the button that was
   * pressed, not to every button in the modal. One at a time either way: a
   * second flow started mid-first would race it for the session.
   */
  const [busy, setBusy] = useState<null | 'tg' | 'x' | 'dev' | 'wallet'>(null);
  const [waiting, setWaiting] = useState(false);
  const [deepLink, setDeepLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);
  /** The wallet list, once the third door is opened */
  const [picking, setPicking] = useState(false);
  /** Which row in that list is mid-signature — the spinner is that wallet's */
  const [signing, setSigning] = useState<string | null>(null);
  const wallets = useBrowserWallets();

  useEffect(() => {
    return () => {
      stopPoll.current?.();
    };
  }, []);

  const startTelegram = async () => {
    if (busy) return;
    setBusy('tg');
    setError(null);
    try {
      const s = await api<TelegramStartDto>('/auth/telegram/start', { method: 'POST' });
      setDeepLink(s.deepLink);
      pendingTgToken.set(s.token);
      window.open(s.deepLink, '_blank', 'noopener');
      setWaiting(true);
      stopPoll.current = pollTelegramLogin(s.token, {
        onResult: (res) => {
          void applyAuth(res, 'telegram').then((authed) => {
            onClose();
            if (!returnTo) router.push(`/p/${authed.portfolioSlug}`);
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
      setBusy(null);
    }
  };

  /**
   * X is a full-page departure and return, not a popup and a poll: OAuth was
   * built for redirects, X's consent page refuses to be framed, and a popup on
   * a phone is a tab you cannot find your way back from. The claim intent in
   * sessionStorage survives the round trip — see the callback page.
   */
  const startX = async () => {
    if (busy) return;
    setBusy('x');
    setError(null);
    try {
      const { url } = await api<XStartDto>('/auth/x/start', { method: 'POST' });
      // Before the departure, because nothing in this closure survives it.
      if (returnTo) parkReturn(returnTo);
      window.location.assign(url);
      // busy stays 'x': the page is leaving; releasing the button now would
      // invite a second start while the first is mid-navigation
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start sign-in");
      setBusy(null);
    }
  };

  /**
   * A wallet was chosen: connect it, sign the server's sentence, and land
   * exactly where every other sign-in lands.
   *
   * The connection is handed in rather than looked up, because the two kinds
   * differ only here — an extension is already in the page, WalletConnect has
   * to be fetched and paired first — and everything after that point is the
   * same wallet-shaped object.
   *
   * The session is closed on the way out, however it ended. It was worth one
   * message; what keeps the visitor signed in afterwards is our own token.
   */
  const walletSignIn = async (id: string, connect: () => Promise<WalletProvider>) => {
    if (busy) return;
    setBusy('wallet');
    setSigning(id);
    setError(null);
    let provider: WalletProvider | null = null;
    try {
      provider = await connect();
      const authed = await applyAuth(await signInWithWallet(provider), 'wallet');
      onClose();
      if (!returnTo) router.push(`/p/${authed.portfolioSlug}`);
    } catch (err) {
      // Closing the wallet's prompt is an answer, not a fault — it says so and
      // leaves the list standing, because the next thing they do is pick again
      setError(
        declined(err)
          ? 'Signature declined — nothing was sent.'
          : err instanceof ApiError || err instanceof Error
            ? err.message
            : "Couldn't finish the wallet sign-in",
      );
      setBusy(null);
      setSigning(null);
    } finally {
      if (provider) void endWalletSession(provider);
    }
  };

  const submitDev = async (event: FormEvent) => {
    event.preventDefault();
    if (!devName.trim() || busy) return;
    setBusy('dev');
    setError(null);
    try {
      const authed = await loginDev(devName.trim());
      onClose();
      if (!returnTo) router.push(`/p/${authed.portfolioSlug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(null);
    }
  };

  const heading = picking ? 'Choose a wallet' : notice ? 'Sign in again' : 'Create your portfolio';

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
      {picking ? null : notice ? (
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
      ) : picking ? (
        /**
         * What is actually here, and one row for everything else.
         *
         * The wallets at the top announced themselves to this page a moment
         * ago — they are installed, and each is one prompt away. WalletConnect
         * is the rest of the world: a QR on a desktop, the wallet app itself on
         * a phone. Naming no wallet we cannot see is the whole trick — a hard
         * list of twelve logos is a promise that goes stale, and ten of them
         * would be things this browser cannot open anyway.
         */
        <>
          <div style={{ marginTop: 'var(--sp-6)', display: 'grid', gap: 'var(--sp-4)' }}>
            {wallets.map((w) => (
              <Button
                key={w.id}
                variant="soft"
                size="lg"
                block
                loading={signing === w.id}
                disabled={busy !== null && signing !== w.id}
                onClick={() => walletSignIn(w.id, async () => w.provider)}
              >
                {w.icon ? (
                  // The wallet's own mark, as it sent it — a data URI, no request
                  <img src={w.icon} alt="" width={16} height={16} style={{ borderRadius: 'var(--r-sm)' }} />
                ) : (
                  WALLET_ICON
                )}
                {w.name}
              </Button>
            ))}

            {config?.walletConnectProjectId ? (
              <Button
                variant="soft"
                size="lg"
                block
                loading={signing === 'walletconnect'}
                disabled={busy !== null && signing !== 'walletconnect'}
                onClick={() =>
                  walletSignIn('walletconnect', () =>
                    connectWalletConnect(config.walletConnectProjectId as string),
                  )
                }
              >
                {QR_ICON}
                WalletConnect
              </Button>
            ) : null}
          </div>

          <Note style={{ textAlign: 'center', marginTop: 'var(--sp-5)', lineHeight: 1.55 }}>
            {wallets.length === 0 && !config?.walletConnectProjectId
              ? 'No wallet answered in this browser. Install one — MetaMask, Rabby — or open svinooh in your wallet’s own browser.'
              : 'You sign one sentence to prove the address is yours. It is not a transaction: nothing moves, nothing is approved, and there is no gas.'}
          </Note>

          <Button
            variant="quiet"
            size="sm"
            block
            disabled={busy !== null}
            onClick={() => {
              setPicking(false);
              setError(null);
            }}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            Other ways to sign in
          </Button>
        </>
      ) : (
        <>
          {config?.botUsername ? (
            <Button
              variant="soft"
              size="lg"
              block
              loading={busy === 'tg'}
              disabled={busy !== null && busy !== 'tg'}
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
              <Button
                type="submit"
                variant="soft"
                size="lg"
                block
                loading={busy === 'dev'}
                disabled={busy !== null && busy !== 'dev'}
                style={{ marginTop: 'var(--sp-4)' }}
              >
                Continue as dev
              </Button>
            </form>
          ) : null}

          <Button
            variant="soft"
            size="lg"
            block
            disabled={!config?.xEnabled || (busy !== null && busy !== 'x')}
            loading={busy === 'x'}
            onClick={config?.xEnabled ? startX : undefined}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <XMark size={12} />
            {config?.xEnabled ? 'Continue with X' : 'Continue with X · soon'}
          </Button>

          {/* The third door opens onto a list rather than a flow: which wallet
              is a question only this browser can answer, and it answers it by
              telling us what is installed. */}
          <Button
            variant="soft"
            size="lg"
            block
            disabled={busy !== null}
            onClick={() => {
              setPicking(true);
              setError(null);
            }}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            {WALLET_ICON}
            Continue with a wallet
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
