import { ConsoleLogger } from '@nestjs/common';
import { serviceName } from './env';

type LokiLevel = 'debug' | 'info' | 'warn' | 'error';
interface Entry {
  ts: string; // nanoseconds as string
  level: LokiLevel;
  context: string;
  line: string;
}

const MAX_BUFFER = 500;
const FLUSH_MS = 2000;
const ANSI = /\[[0-9;]*m/g;

/**
 * Logger that prints to stdout as usual (Railway captures it) and, in parallel,
 * ships log lines to Loki in batches. Without LOKI_URL it is a plain
 * ConsoleLogger. Not a Nest provider: installed in main.ts via app.useLogger so
 * it also captures bootstrap logs. Every shipped line is prefixed with the
 * writing service's context, e.g. "[SyncService] ...".
 */
export class LokiLogger extends ConsoleLogger {
  private buffer: Entry[] = [];
  private lastMs = 0;
  private seq = 0;
  private readonly lokiUrl = process.env.LOKI_URL || null;
  private readonly app = serviceName();
  private readonly enabled = !!this.lokiUrl;

  constructor() {
    super();
    if (this.enabled) {
      setInterval(() => void this.flush(), FLUSH_MS).unref?.();
    }
  }

  log(message: unknown, ...rest: unknown[]): void {
    super.log(message as string, ...(rest as string[]));
    this.capture('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    super.error(message as string, ...(rest as string[]));
    this.capture('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(message as string, ...(rest as string[]));
    this.capture('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    super.debug(message as string, ...(rest as string[]));
    this.capture('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(message as string, ...(rest as string[]));
    this.capture('debug', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    super.fatal(message as string, ...(rest as string[]));
    this.capture('error', message, rest);
  }

  private capture(level: LokiLevel, message: unknown, params: unknown[]): void {
    if (!this.enabled) return;
    // Nest passes the context as the last string argument
    const context =
      params.length && typeof params[params.length - 1] === 'string'
        ? (params[params.length - 1] as string)
        : 'App';
    const extra = (context && params.length ? params.slice(0, -1) : params).filter(
      (p) => p !== undefined && p !== null,
    );
    const text = [message, ...extra].map((p) => fmt(p)).join(' ').replace(ANSI, '').trim();
    if (!text) return;
    // Prefix every line with the writing service's name
    const line = `[${context}] ${text}`;
    this.buffer.push({ ts: this.tsNs(), level, context, line });
    if (this.buffer.length >= MAX_BUFFER) void this.flush();
  }

  private tsNs(): string {
    const ms = Date.now();
    if (ms !== this.lastMs) {
      this.lastMs = ms;
      this.seq = 0;
    }
    return (BigInt(ms) * 1_000_000n + BigInt(this.seq++)).toString();
  }

  private async flush(): Promise<void> {
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    // Group by label set (level + context) — that is how Loki streams work
    const streams = new Map<string, { stream: Record<string, string>; values: [string, string][] }>();
    for (const e of batch) {
      const key = `${e.level} ${e.context}`;
      let s = streams.get(key);
      if (!s) {
        s = { stream: { app: this.app, level: e.level, context: e.context }, values: [] };
        streams.set(key, s);
      }
      s.values.push([e.ts, e.line]);
    }
    try {
      await fetch(`${this.lokiUrl}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ streams: [...streams.values()] }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Loki unreachable — drop the batch; logging must never crash the app
    }
  }
}

function fmt(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
