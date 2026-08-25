import { config } from '../config';
import { sleep } from '../common/util';

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
 * fetch с JSON, таймаутом и ретраями с экспоненциальным бэкоффом.
 * Внешние API без ключей — значит без гарантий: 5xx/429 и сетевые ошибки
 * ретраим, 4xx — нет (это наша ошибка, повтор не поможет).
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
