/**
 * The seam between billing and whoever carries the money.
 *
 * Both gateways an RU-reachable product can use carry platform risk — one is
 * formally prohibited from serving RU residents by its own terms, the other is
 * appealing a record AML fine — so the day either has to go, this interface
 * and one webhook route are the whole cost of leaving. Checkout knows only
 * this shape; everything provider-specific lives in the two client files.
 */

export interface InvoiceRequest {
  priceUsd: number;
  /** Ours, echoed back by the webhook — how a callback finds its Payment row */
  orderId: string;
  description: string;
  /** null — no callback requested (local development) */
  ipnUrl: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CreatedInvoice {
  invoiceId: string;
  /** The hosted payment page: the payer picks a coin and network there */
  url: string;
}

export interface PaymentGateway {
  /** What Payment.provider records: 'cryptomus' | 'nowpayments' */
  readonly name: string;
  /** Unconfigured — checkout says so instead of pretending */
  readonly enabled: boolean;
  createInvoice(request: InvoiceRequest): Promise<CreatedInvoice>;
}
