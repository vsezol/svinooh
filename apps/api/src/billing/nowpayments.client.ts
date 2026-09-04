import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreatedInvoice, InvoiceRequest, PaymentGateway } from './gateway';

/**
 * The NOWPayments corner of billing — the default gateway.
 *
 * Chosen on operating experience over paperwork: the operator has run an
 * account here for years without trouble, every payment auto-forwards to our
 * own wallet (no custodial balance to sweep and no one to freeze it), the
 * webhook signature is a real HMAC, and the sandbox exercises the whole
 * checkout-to-webhook path with play money. The known caveat stays known:
 * their terms (s.15.1, as of 2026-08-31) list RU residents as prohibited "at
 * their own risk" — which is why Cryptomus stays wired in behind the same
 * seam, one env var away.
 *
 * The class takes its credentials as arguments rather than reading config, so
 * the check scripts can exercise it against a fake server and the sandbox.
 */

/**
 * JSON with every object's keys sorted, at every depth — the exact string
 * NOWPayments signs. Their IPN signature is HMAC-SHA512 over the request body
 * re-serialized this way, so byte-for-byte agreement on ordering IS the
 * verification.
 */
export function sortedJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function ipnSignature(body: unknown, secret: string): string {
  return createHmac('sha512', secret).update(sortedJson(body)).digest('hex');
}

/** Constant-time, and false for a missing header or an empty secret */
export function ipnSignatureValid(
  body: unknown,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(ipnSignature(body, secret));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The gateway's payment lifecycle, folded to ours. `confirmed` and `sending`
 * are one thing to us — money observed, not yet ours to count — and anything
 * unrecognized maps to null so a status added on their side is ignored loudly
 * (logged by the caller) rather than misfiled.
 */
export function paymentStatusOf(gateway: string): string | null {
  switch (gateway) {
    case 'waiting':
      return 'waiting';
    case 'confirming':
    case 'confirmed':
    case 'sending':
      return 'confirming';
    case 'finished':
      return 'paid';
    case 'partially_paid':
      return 'underpaid';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}

export class NowPaymentsClient implements PaymentGateway {
  readonly name = 'nowpayments';

  constructor(
    private readonly apiKey: string,
    private readonly ipnSecret: string,
    private readonly apiUrl: string,
  ) {}

  /** No key — payments are simply not configured; the offer still answers */
  get enabled(): boolean {
    return this.apiKey !== '';
  }

  /**
   * A fixed-price USD invoice with a hosted page. The invoice is priced in
   * dollars and the payer picks the coin on NOWPayments' side — which is the
   * whole reason to use a gateway: one integration, every network they carry.
   */
  async createInvoice(request: InvoiceRequest): Promise<CreatedInvoice> {
    const res = await fetch(`${this.apiUrl}/invoice`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        price_amount: request.priceUsd,
        price_currency: 'usd',
        order_id: request.orderId,
        order_description: request.description,
        ...(request.ipnUrl ? { ipn_callback_url: request.ipnUrl } : {}),
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`nowpayments invoice: ${res.status} ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as { id?: string | number; invoice_url?: string };
    if (!body.invoice_url) throw new Error('nowpayments invoice: answer carries no invoice_url');
    return { invoiceId: body.id === undefined ? '' : String(body.id), url: body.invoice_url };
  }

  verify(body: unknown, signatureHeader: string | undefined): boolean {
    return ipnSignatureValid(body, signatureHeader, this.ipnSecret);
  }
}
