import type { ApiErrorDto, ProFeature, ProLimitsDto, ProOfferDto } from '@svinooh/shared';

/**
 * The arithmetic of the pitch, done once and on the server.
 *
 * Every discount percent anywhere — the marketing page, a paywall dialog, a
 * Telegram message — is derived here from the two prices, so no surface can
 * advertise a number the checkout would contradict. A "was" price at or under
 * the live one yields 0%, not a negative badge.
 */
export function buildOffer(input: {
  priceUsd: number;
  wasPriceUsd: number;
  firstMonthUsd: number;
  limits: ProLimitsDto;
}): ProOfferDto {
  const off = (price: number, was: number): number =>
    was > price ? Math.round((1 - price / was) * 100) : 0;
  return {
    priceUsd: input.priceUsd,
    wasPriceUsd: input.wasPriceUsd,
    discountPct: off(input.priceUsd, input.wasPriceUsd),
    firstMonthUsd: input.firstMonthUsd,
    firstMonthDiscountPct: off(input.firstMonthUsd, input.wasPriceUsd),
    limits: input.limits,
  };
}

/**
 * What a paywall says, per limit. Each message names the limit that was hit
 * and the way out with today's prices — the same rule the ANONYMOUS_LIMIT
 * message set: an error that only says no is an error that reads as broken.
 */
export function paywallMessage(feature: ProFeature, offer: ProOfferDto): string {
  const { limits } = offer;
  const deal = `$${offer.priceUsd}/month instead of $${offer.wasPriceUsd}, first month $${offer.firstMonthUsd}`;
  switch (feature) {
    case 'portfolios':
      return `The free plan is ${limits.freePortfolios} portfolio${limits.freePortfolios === 1 ? '' : 's'}. Svinooh.Pro removes the limit — ${deal}.`;
    case 'wallets':
      return `The free plan holds ${limits.freeWalletsPerPortfolio} wallets per portfolio. Svinooh.Pro removes the cap — ${deal}.`;
    case 'history':
      return `The free plan reaches ${limits.freeHistoryDays} days back. Svinooh.Pro shows the whole history — ${deal}.`;
    case 'alerts':
      return `The free plan includes ${limits.freeAlerts} alerts and they are spent. Svinooh.Pro keeps them coming — ${deal}.`;
    case 'ai':
      return `The free plan answers ${limits.freeAiPerDay} agent question${limits.freeAiPerDay === 1 ? '' : 's'} a day. Svinooh.Pro removes the limit — ${deal}.`;
  }
}

/**
 * The body of every 402: one code for the client to branch on, the feature the
 * dialog is about, and the whole offer — so the paywall can be drawn from the
 * error alone, without a second request that might answer different numbers.
 */
export function paywallBody(feature: ProFeature, offer: ProOfferDto): ApiErrorDto {
  return {
    statusCode: 402,
    code: 'PRO_REQUIRED',
    message: paywallMessage(feature, offer),
    feature,
    offer,
  };
}

/**
 * A calendar month later, with the day clamped to what the month has: Jan 31
 * plus one month is Feb 28, not Mar 3. Chosen over a flat 30 days because the
 * marketing says "per month" and the renewal date staying on the same day of
 * the month is what makes that claim checkable.
 */
export function addMonths(from: Date, months: number): Date {
  const out = new Date(from.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** The UTC day a moment belongs to, as FeatureUsage.aiDay spells it */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Whether the operator's chosen checkout coin may carry this price — the
 * coin to lock the invoice to, or null for the gateway's open page.
 *
 * Null on an unknown minimum too: a lock we cannot vouch for is an invoice
 * that might be unpayable, and the open page is never wrong — the knob's
 * choice degrades to it rather than to a dead checkout.
 */
export function coinLock(coin: string, minUsd: number | null, priceUsd: number): string | null {
  if (coin === 'page') return null;
  if (minUsd === null || minUsd > priceUsd) return null;
  return coin;
}
