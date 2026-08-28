import type { ApiErrorDto } from '@svinooh/shared';

// Empty — same-origin; in production on Railway NEXT_PUBLIC_API_URL is set at
// build time and inlined into the bundle
const API_URL: string = process.env.NEXT_PUBLIC_API_URL || '';
const TOKEN_KEY = 'svinooh_token';

// Telegram's in-app browser, private windows and WebViews with site data
// switched off can all make localStorage throw on the way in — and a throw here
// took the whole app down with it. The session then lives for the page instead
// of surviving a reload, which is worth infinitely more than a blank screen.
let memoryToken: string | null = null;

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set: (token: string): void => {
    memoryToken = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* no storage — the in-memory copy carries this page */
    }
  },
  clear: (): void => {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * How many requests this page has in the air, and who is waiting for that to
 * reach zero.
 *
 * Work nobody asked for waits here. A prefetch is by definition something no
 * one is looking at, and one that races a request somebody IS looking at has
 * made the page slower in order to save a click later.
 */
let inFlight = 0;
let idleWaiters: Array<() => void> = [];

function drained(): void {
  inFlight--;
  if (inFlight > 0) return;
  const waiting = idleWaiters;
  idleWaiters = [];
  for (const wake of waiting) wake();
}

/** Resolves the moment nothing is being fetched — at once, if nothing is */
export function whenNetworkIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
  });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  inFlight++;
  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, 'Server unavailable');
    }

    if (!res.ok) {
      let body: Partial<ApiErrorDto> & { message?: string | string[] } = {};
      try {
        body = await res.json();
      } catch {
        // not JSON — keep the default message
      }
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      throw new ApiError(res.status, message || `Error ${res.status}`, body.code);
    }
    return (await res.json()) as T;
  } finally {
    // Reading the body counts: a prefetch that starts while a large response is
    // still streaming is competing for the same connection
    drained();
  }
}
