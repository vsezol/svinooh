import { createHash, timingSafeEqual } from 'node:crypto';
import type { CreatedInvoice, InvoiceRequest, PaymentGateway } from './gateway';

/**
 * The Cryptomus corner of billing — the standing fallback behind the seam.
 *
 * It earned the spot on coverage: invoices from ~1 USDT on the rails our
 * users actually hold (USDT TRC-20, TON, SOL, BSC), so even the 2 USD welcome
 * invoice survives, and it onboards an individual. It is not the default
 * because NOWPayments is the account the operator has actually run for years
 * — and because Cryptomus' cloud is regulatory (a record FINTRAC fine under
 * appeal), so if it is ever switched on, funds must be swept out on a
 * schedule rather than left on the custodial balance.
 *
 * Their signature scheme (both directions) is
 * `md5( base64( json_encode(body) ) + API_KEY )` — PHP's json_encode, which
 * escapes forward slashes and non-ASCII where JSON.stringify does not. The
 * escaping helpers below reproduce that, byte for byte, or verification fails
 * only on payloads carrying a URL or a non-Latin character: intermittently,
 * which is the worst way.
 */

/** JSON.stringify, then PHP json_encode's default escapes on top */
export function phpJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\//g, '\\/')
    .replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function cryptomusSign(body: unknown, apiKey: string): string {
  return createHash('md5')
    .update(Buffer.from(phpJson(body)).toString('base64') + apiKey)
    .digest('hex');
}

/**
 * A webhook's own `sign` is computed over the body WITHOUT the sign field —
 * their reference implementation unsets it and re-encodes. Constant-time
 * compare, and false outright when the secret is not configured.
 */
export function cryptomusWebhookValid(body: Record<string, unknown>, apiKey: string): boolean {
  if (!apiKey || typeof body.sign !== 'string') return false;
  const { sign, ...rest } = body;
  const expected = Buffer.from(cryptomusSign(rest, apiKey));
  const given = Buffer.from(sign);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Their payment lifecycle, folded to ours. `paid_over` counts as paid — money
 * beyond the price is not a problem to solve. `wrong_amount` is under the
 * price and stays a human decision. Anything unrecognized maps to null and is
 * logged by the caller rather than misfiled.
 */
export function cryptomusStatusOf(status: string): string | null {
  switch (status) {
    case 'check':
      return 'waiting';
    case 'process':
    case 'confirm_check':
      return 'confirming';
    case 'paid':
    case 'paid_over':
      return 'paid';
    case 'wrong_amount':
    case 'wrong_amount_waiting':
      return 'underpaid';
    case 'fail':
    case 'system_fail':
      return 'failed';
    case 'cancel':
      return 'expired';
    case 'refund_paid':
      return 'refunded';
    default:
      return null;
  }
}

export class CryptomusClient implements PaymentGateway {
  readonly name = 'cryptomus';

  constructor(
    private readonly merchantId: string,
    private readonly apiKey: string,
    private readonly apiUrl: string,
  ) {}

  get enabled(): boolean {
    return this.merchantId !== '' && this.apiKey !== '';
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        merchant: this.merchantId,
        sign: cryptomusSign(body, this.apiKey),
        'content-type': 'application/json',
      },
      // The signature is over these exact bytes, so the body is the same
      // phpJson the signature saw — not a second stringify that might differ
      body: phpJson(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`cryptomus ${path}: ${res.status} ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  /**
   * A USD-denominated hosted invoice: the payer picks a coin and network on
   * Cryptomus' page, from the rails whose minimum fits the amount. Two hours
   * to pay — wallets get fumbled, and an expired invoice is one click to
   * reissue from our side.
   */
  async createInvoice(request: InvoiceRequest): Promise<CreatedInvoice> {
    const answer = await this.post<{ result?: { uuid?: string; url?: string } }>('/payment', {
      amount: request.priceUsd.toFixed(2),
      currency: 'USD',
      order_id: request.orderId,
      lifetime: 7200,
      ...(request.ipnUrl ? { url_callback: request.ipnUrl } : {}),
      url_success: request.successUrl,
      url_return: request.cancelUrl,
    });
    if (!answer.result?.url) throw new Error('cryptomus /payment: answer carries no url');
    return { invoiceId: answer.result.uuid ?? '', url: answer.result.url };
  }

  /**
   * The payment as Cryptomus itself answers for it right now. Called before a
   * webhook's `paid` is believed: an MD5-of-base64 signature is thin armor for
   * the one step that grants a month, and asking the source costs one call.
   */
  async paymentStatus(orderId: string): Promise<string | null> {
    const answer = await this.post<{ result?: { payment_status?: string; status?: string } }>(
      '/payment/info',
      { order_id: orderId },
    );
    const status = answer.result?.payment_status ?? answer.result?.status;
    return typeof status === 'string' ? cryptomusStatusOf(status) : null;
  }
}
