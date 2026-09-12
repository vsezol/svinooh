import posthog from 'posthog-js';

/** Every door a sign-in can come through — the property that splits the funnel */
export type SignInMethod = 'telegram' | 'x' | 'wallet' | 'dev';

/**
 * Every product event this app reports, with the properties it carries.
 * Captures go through track(), which only accepts what is declared here — a
 * misspelled event name would otherwise become a real event in PostHog and
 * quietly dilute the one it was meant to be.
 *
 * Nothing in these properties may identify anyone: no addresses, no slugs, no
 * amounts. The chain of a wallet and the visibility of a portfolio say what
 * kind of thing happened without saying whose.
 */
interface ProductEvents {
  /** A successful sign-in, whichever flow completed it */
  signed_in: { method: SignInMethod };
  /**
   * The landing's composer used as the front door: a first question asked, and
   * the page handed over to the chat. No properties — what was typed is the
   * visitor's, and often a wallet address.
   */
  landing_asked: Record<string, never>;
  /**
   * A portfolio brought into being. 'switcher' is the only live source: the
   * landing's address box is gone — the composer sends everything to the chat
   * now — and 'landing' stays in the union because the events it produced are
   * still in PostHog.
   */
  portfolio_created: { source: 'landing' | 'switcher' };
  /** A wallet added to a portfolio that already exists */
  wallet_added: { chain: string };
  /** An ownerless portfolio taken over by an account */
  portfolio_claimed: { source: 'page' | 'signin' };
  /** An owned portfolio deleted by its owner — the red line at the page's end */
  portfolio_deleted: { source: 'page' };
  /** Somebody opened a portfolio they do not own and stayed on it */
  shared_link_opened: { visibility: string };
  /** A free-plan limit was hit and the dialog opened — the top of the funnel */
  paywall_shown: { feature: string };
  /** The dialog's button pressed — on the way to /pro */
  paywall_cta: { feature: string };
  /** The /pro page opened, however they got there */
  pro_opened: Record<string, never>;
  /** The buy button pressed and a checkout requested from the gateway */
  checkout_opened: { firstMonth: boolean };
}

/**
 * posthog.init runs in instrumentation-client.ts only when the key is present;
 * without it every helper here is a no-op, which is what local development and
 * preview builds want.
 */
const ready = (): boolean => posthog.__loaded;

export function track<E extends keyof ProductEvents>(event: E, properties: ProductEvents[E]): void {
  if (ready()) posthog.capture(event, properties);
}

/**
 * Ties this browser's events to an account — the internal user id, and the door
 * they came in by. No name, no Telegram handle, no address: the id is enough to
 * count one person as one person across visits, and the door is the same fact
 * the `svinooh_users` gauge carries as a label.
 *
 * The method is passed on a sign-in and left out on a returning session, which
 * is exactly right: PostHog leaves a property alone when identify does not
 * mention it, so the door survives every later visit without being restated.
 *
 * Without it, wallet sign-ins were countable as EVENTS and invisible as PEOPLE
 * — the funnel could say how many signed in that way and the person list could
 * not say how many exist.
 */
export function identify(userId: string, method?: SignInMethod): void {
  if (ready()) posthog.identify(userId, method ? { signin_method: method } : undefined);
}

/** Signed out: the next events belong to a fresh anonymous visitor, not to the account */
export function resetIdentity(): void {
  if (ready()) posthog.reset();
}
