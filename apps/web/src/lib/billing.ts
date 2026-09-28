import type { BillingMeDto, CheckoutDto, ProOfferDto } from '@svinooh/shared';
import { api, ApiError } from './api';

/**
 * The 402 that carries its own paywall. The server puts the whole offer on the
 * error, so a dialog drawn from it can never quote numbers the checkout would
 * disagree with — and needs no second request to open.
 */
export function isPaywall(err: unknown): err is ApiError & { offer: ProOfferDto } {
  return err instanceof ApiError && err.code === 'PRO_REQUIRED' && err.offer !== undefined;
}

/** The pitch, public — what the /pro page and the paywall are drawn from */
export const getOffer = (): Promise<ProOfferDto> => api<ProOfferDto>('/billing/offer');

/** The signed-in user's standing: plan, paid-until, usage, recent payments */
export const getBillingMe = (): Promise<BillingMeDto> => api<BillingMeDto>('/billing/me');

/**
 * Opens a checkout and answers with the hosted page's URL — the caller
 * decides which tab it goes into. Which coins the page offers is the
 * gateway's business, curated in its dashboard; it hides by itself the ones
 * whose network minimum does not fit the amount.
 *
 * `key` names one attempt to pay. Asked again under the same key while its
 * invoice can still be paid, the server answers with that invoice rather than
 * opening a second one.
 */
export async function openCheckout(key: string): Promise<string> {
  const { url } = await api<CheckoutDto>('/billing/checkout', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
  });
  return url;
}
