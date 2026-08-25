import { createHash, randomUUID } from 'node:crypto';
import { Impit, type ImpitResponse } from 'impit';
import { config } from '../config';
import { sleep } from '../common/util';

/**
 * Клиент публичного веб-API debank.com. Веб-страница DeBank подписывает
 * каждый свой запрос (x-api-nonce / x-api-sign / x-api-ts, свежие на каждый
 * вызов) — тем же алгоритмом, что воспроизведён здесь. Это ровно те запросы,
 * которые делает браузер любого анонимного посетителя profile-страницы:
 * данные там бесплатны и видны без входа. Отдельный платный Portfolio API
 * (api.debank.com c API-ключом) мы НЕ трогаем — ключа нет и он не нужен.
 *
 * Порт debank-re (LuKks, MIT) на TypeScript. impit нужен ради TLS-отпечатка
 * Chrome: обычный fetch из Node Cloudflare режет по JA3, impit — нет.
 *
 * Сделано первичным путём EVM-сканера (быстро, без headless-браузера); при
 * любой осечке — фоллбэк на чтение отрисованной страницы через Chrome.
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

/** Инкрементный PRNG (pcg32) → 40-символьный nonce, как в вебе DeBank */
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

/** Двойной SHA256 с XOR-подмешиванием nonce/ts — подпись x-api-sign */
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
    // Каждая попытка — со свежими nonce/ts/подписью (они одноразовые).
    // Ретраим только транзиентное (429/5xx/сеть); 4xx и error_code — сразу
    // наружу, чтобы evm.ts откатился на Chrome без лишних кругов.
    const tries = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) await sleep(600 * 2 ** (attempt - 1));
      try {
        return await this.attempt<T>(pathname, params);
      } catch (error) {
        lastError = error;
        // 429 НЕ ретраим: это «сбавь темп», повтор только продлевает бан.
        // Отдаём наружу сразу — пусть сработает circuit breaker + Chrome.
        // Ретраим лишь 5xx и сетевые сбои (реально транзиентное).
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
    // Порядок параметров в query ДОЛЖЕН совпадать с тем, что ушло в подпись:
    // DeBank ждёт их в обратном порядке добавления
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
      // 200, но не JSON — это HTML-заглушка Cloudflare/nginx, не наш формат
      throw new DebankError(`non-JSON response on ${pathname}`, res.status);
    }
    if (body.error_code) {
      throw new DebankError(
        `DeBank ${body.error_code}: ${body.error_msg || ''} на ${pathname}`,
        res.status,
        body.error_code,
      );
    }
    return body.data as T;
  }
}

// Один клиент на сервис: переиспользуем TLS-соединение и UID.
let client: DebankClient | null = null;
export function debank(): DebankClient {
  return (client ??= new DebankClient());
}
