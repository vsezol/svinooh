import type { AuthResponseDto, TelegramPollDto } from '@svinooh/shared';
import { api, ApiError } from './api';

// Bot sign-in token that survives leaving for the Telegram app and coming back:
// on mobile the tab goes to the background (timers sleep), and the user may
// return to the same tab or via the bot's button (a new tab with ?tg_login).
const KEY = 'svinooh_tg_pending';

export const pendingTgToken = {
  get(): string | null {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      /* private mode — just skip persistence */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* no-op */
    }
  },
};

interface PollOpts {
  onResult: (res: AuthResponseDto) => void;
  onError: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Polls /auth/telegram/poll until the login is ready. Resilient to a
 * backgrounded tab going to sleep: on regaining focus it ticks immediately,
 * without waiting for the timer. Returns a cancel function.
 */
export function pollTelegramLogin(token: string, opts: PollOpts): () => void {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  let cancelled = false;
  let timer: number | undefined;

  const stop = () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };

  const tick = async () => {
    if (cancelled) return;
    try {
      const res = await api<TelegramPollDto>(
        `/auth/telegram/poll?token=${encodeURIComponent(token)}`,
      );
      if (cancelled) return;
      if ('token' in res) {
        stop();
        pendingTgToken.clear();
        opts.onResult(res);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        stop();
        opts.onError('Timed out — please try again');
        return;
      }
      timer = window.setTimeout(() => void tick(), 2000);
    } catch (err) {
      if (cancelled) return;
      stop();
      pendingTgToken.clear();
      opts.onError(err instanceof ApiError ? err.message : 'Session expired — please try again');
    }
  };

  const onVisible = () => {
    if (cancelled || document.hidden) return;
    if (timer) window.clearTimeout(timer);
    void tick();
  };

  document.addEventListener('visibilitychange', onVisible);
  timer = window.setTimeout(() => void tick(), 1200);
  return stop;
}
