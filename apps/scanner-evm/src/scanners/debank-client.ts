import { createHash, randomUUID } from 'node:crypto';
import { Impit, type ImpitResponse } from 'impit';
import { config } from '../config';
import { sleep } from '@svinooh/common';

/**
 * Client for the public debank.com web API. The DeBank web page signs each of
 * its requests (x-api-nonce / x-api-sign / x-api-ts, fresh on every call) with
 * the same algorithm reproduced here. These are exactly the requests the
 * browser of any anonymous visitor to a profile page makes: the data there is
 * free and visible without logging in. We do NOT touch the separate paid
 * Portfolio API (api.debank.com with an API key) — we have no key and don't need one.
 *
 * A TypeScript port of debank-re (LuKks, MIT). impit is needed for Chrome's TLS
 * fingerprint: a plain fetch from Node gets cut off by Cloudflare on JA3, impit doesn't.
 *
 * Set up as the EVM scanner's primary path (fast, no headless browser); on any
 * miss, fall back to reading the rendered page via Chrome.
 */

const API_URL = 'https://api.debank.com';

interface DebankBody<T> {
  data?: T;
  error_code?: number;
  error_msg?: string;
}

export class DebankError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** Incremental PRNG (pcg32) → 40-char nonce, as on the DeBank web page */
class DebankNonce {
  private static readonly ABC =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz';
  private local = 0n;

  private pcg32(): number {
    const tmp = this.local * 6364136223846793005n + 1n;
    this.local = BigInt.asIntN(64, tmp);
    return Number(BigInt.asUintN(64, this.local) >> 33n);
  }

  next(): string {
    const result: string[] = [];
    for (let i = 0; i < 40; i++) {
      const index = Math.trunc((this.pcg32() / 2147483647.0) * 61.0);
      result.push(DebankNonce.ABC[index]);
    }
    return result.join('');
  }
}

const sha256 = (data: string | Buffer): Buffer => createHash('sha256').update(data).digest();

/** Double SHA256 with XOR-mixed nonce/ts — the x-api-sign signature */
class DebankSigner {
  sign(
    req: { method: string; pathname: string; query: string },
    meta: { nonce: string; ts: number },
  ): string {
    const data1 = `${req.method}\n${req.pathname}\n${req.query}`;
    const data2 = `debank-api\nn_${meta.nonce}\n${meta.ts}`;

    const hash1 = sha256(data1).toString('hex');
    const hash2 = sha256(data2).toString('hex');
    const [xor1, xor2] = this.xor(hash2);

    const h1 = sha256(Buffer.from(xor1 + hash1, 'utf-8'));
    const h2 = sha256(Buffer.concat([Buffer.from(xor2, 'utf-8'), h1]));
    return h2.toString('hex');
  }

  private xor(hash: string): [string, string] {
    const rez1: string[] = [];
    const rez2: string[] = [];
    for (let i = 0; i < 64; i++) {
      const code = hash.charCodeAt(i);
      rez1.push(String.fromCharCode(code ^ 54));
      rez2.push(String.fromCharCode(code ^ 92));
    }
    return [rez1.join(''), rez2.join('')];
  }
}

function makeBrowserUID() {
  return {
    random_at: Math.floor(Date.now() / 1000),
    random_id: randomUUID().replace(/-/g, ''),
    user_addr: null,
  };
}

const encodeParams = ([k, v]: [string, string]): string =>
  `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;

class DebankClient {
  private readonly account = makeBrowserUID();
  private readonly nonce = new DebankNonce();
  private readonly signer = new DebankSigner();
  private readonly impit = new Impit({
    browser: 'chrome',
    proxyUrl: config.debankProxyUrl || undefined,
    timeout: config.httpTimeoutMs,
  });

  private headers(method: string, pathname: string, query: string): Record<string, string> {
    const nonce = this.nonce.next();
    const ts = Math.floor(Date.now() / 1000);
    const signature = this.signer.sign({ method, pathname, query }, { nonce, ts });
    return {
      'x-api-nonce': `n_${nonce}`,
      'x-api-sign': signature,
      'x-api-ts': ts.toString(),
      'x-api-ver': 'v2',
    };
  }

  async get<T>(pathname: string, params: Record<string, string | number>): Promise<T> {
    // Each attempt uses a fresh nonce/ts/signature (they're single-use).
    // We retry only transient failures (429/5xx/network); 4xx and error_code go
    // straight out so evm.ts falls back to Chrome without extra round-trips.
    const tries = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) await sleep(600 * 2 ** (attempt - 1));
      try {
        return await this.attempt<T>(pathname, params);
      } catch (error) {
        lastError = error;
        // We do NOT retry 429: it means "slow down", and retrying only extends the ban.
        // Pass it straight out — let the circuit breaker + Chrome kick in.
        // We retry only 5xx and network failures (genuinely transient).
        const retryable =
          error instanceof DebankError &&
          error.status !== 429 &&
          (error.status === undefined || error.status >= 500);
        if (!retryable) throw error;
      }
    }
    throw lastError;
  }

  private async attempt<T>(pathname: string, params: Record<string, string | number>): Promise<T> {
    // The parameter order in the query MUST match what went into the signature:
    // DeBank expects them in reverse insertion order
    const search = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    );
    const query = '?' + [...search.entries()].reverse().map(encodeParams).join('&');
    const headers = this.headers('GET', pathname, query);

    let res: ImpitResponse;
    try {
      res = await this.impit.fetch(API_URL + pathname + query, {
        method: 'GET',
        headers: { source: 'web', account: JSON.stringify(this.account), ...headers },
      });
    } catch (error) {
      throw new DebankError(`network unavailable: ${error instanceof Error ? error.message : error}`);
    }

    if (!res.ok) throw new DebankError(`HTTP ${res.status} on ${pathname}`, res.status);

    let body: DebankBody<T>;
    try {
      body = (await res.json()) as DebankBody<T>;
    } catch {
      // 200 but not JSON — an HTML stub from Cloudflare/nginx, not our format
      throw new DebankError(`non-JSON response on ${pathname}`, res.status);
    }
    if (body.error_code) {
      throw new DebankError(
        `DeBank ${body.error_code}: ${body.error_msg || ''} on ${pathname}`,
        res.status,
        body.error_code,
      );
    }
    return body.data as T;
  }
}

// One client per service: we reuse the TLS connection and UID.
let client: DebankClient | null = null;
export function debank(): DebankClient {
  return (client ??= new DebankClient());
}
