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
 * Opens a checkout and hands this tab to the gateway's hosted page — the coin,
 * the network and the paying all happen there, and the success URL brings the
 * payer back to /pro.
 */
export async function startCheckout(): Promise<void> {
  const { url } = await api<CheckoutDto>('/billing/checkout', { method: 'POST' });
  window.location.assign(url);
}
