import { Logger } from '@nestjs/common';

const log = new Logger('JsonApi');

export const USER_AGENT = 'svinooh-earn/1.0 (+https://svinooh.com)';

export interface JsonTransport {
  get(path: string, params?: Record<string, string | number | null | undefined>): Promise<unknown>;
}

export class JsonApi implements JsonTransport {
  private readonly baseUrl: string;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    baseUrl: string,
    private readonly timeoutMs: number,
    private readonly concurrency: number,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async get(
    path: string,
    params: Record<string, string | number | null | undefined> = {},
  ): Promise<unknown> {
    await this.enter();
    try {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
      }
      const answered = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!answered.ok) throw new Error(`${answered.status} from ${url.pathname}`);
      return await answered.json();
    } finally {
      this.leave();
    }
  }

  private async enter(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
  }

  private leave(): void {
    this.running--;
    this.waiting.shift()?.();
  }
}

export async function gatherSuccessful<T, R>(
  items: T[],
  run: (item: T) => Promise<R>,
  label: string,
): Promise<R[]> {
  const outcomes = await Promise.allSettled(items.map((item) => run(item)));
  const kept: R[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      log.warn(`${label}: ${String(items[index])} could not be read: ${outcome.reason}`);
      return;
    }
    kept.push(outcome.value);
  });
  return kept;
}
