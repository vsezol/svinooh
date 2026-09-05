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
 * decides which tab it goes into. `payCurrency` locks the invoice to one
 * stable rail (a BillingMeDto.payOptions code); 'any' or absent lets the
 * payment page offer the gateway's full list.
 */
export async function openCheckout(payCurrency?: string): Promise<string> {
  const body =
    payCurrency && payCurrency !== 'any' ? JSON.stringify({ payCurrency }) : undefined;
  const { url } = await api<CheckoutDto>('/billing/checkout', { method: 'POST', body });
  return url;
}
