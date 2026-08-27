import { config } from '../config';
import { sleep } from '@svinooh/common';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
  }
}

const isRetryableStatus = (status: number) => status >= 500 || status === 429;

/**
 * fetch with JSON, a timeout, and retries with exponential backoff.
 * Keyless external APIs come with no guarantees: we retry 5xx/429 and network
 * errors, but not 4xx (that's our own error — retrying won't help).
 */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  opts: { tries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const timeoutMs = opts.timeoutMs ?? config.httpTimeoutMs;
  let lastError: unknown;

  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !isRetryableStatus(error.status)) throw error;
    }
  }
  throw lastError;
}
