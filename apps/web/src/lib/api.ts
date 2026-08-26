import type { ApiErrorDto } from '@svinooh/shared';

// Empty — same-origin (Vite dev proxy or shared domain);
// in production on Railway, VITE_API_URL is set at build time
const API_URL: string = import.meta.env.VITE_API_URL || '';
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token) headers['Authorization'] = `Bearer ${token}`;

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
  return res.json() as Promise<T>;
}
