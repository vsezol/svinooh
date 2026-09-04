import posthog from 'posthog-js';

/**
 * Analytics bootstrap — Next runs this file once in the browser, before the
 * app hydrates. Without the key nothing initializes and every track() call in
 * the app is a no-op: local dev and preview builds send nothing anywhere.
 */

/**
 * A share link IS the access to a private portfolio — the slug in /p/<slug>
 * opens it. Analytics events carry URLs in a dozen properties ($current_url,
 * $referrer, heatmap keys, entry pages), so before anything leaves the page
 * every string that contains a portfolio path loses its slug. Heatmaps then
 * aggregate all portfolio pages under one key, which is the useful reading of
 * them anyway.
 */
const SLUG_IN_PATH = /\/p\/[^/?#]+/g;

function scrubbed(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SLUG_IN_PATH, '/p/:slug');
  if (Array.isArray(value)) return value.map(scrubbed);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key.replace(SLUG_IN_PATH, '/p/:slug')] = scrubbed(entry);
    }
    return out;
  }
  return value;
}

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    // Dev builds narrate every capture to the console; production stays quiet.
    // Local runs have no key at all, so this only speaks when one is set.
    debug: process.env.NODE_ENV === 'development',
    // Our own origin, rewritten to PostHog's EU cloud in next.config.mjs.
    // Blocklists key on analytics domains; this way they never see one.
    api_host: '/relay',
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    // No cookies. localStorage only, so a visit stores nothing a consent
    // banner would have to ask about, and a returning visitor still counts as
    // the same visitor.
    persistence: 'localStorage',
    // A person exists in PostHog only once identify() runs at sign-in;
    // anonymous visitors stay anonymous counts.
    person_profiles: 'identified_only',
    // Autocapture ships the text of what was clicked, and on this site the
    // text of things is addresses and dollar figures. Heatmaps are coordinates
    // only, so they stay.
    autocapture: false,
    capture_heatmaps: true,
    session_recording: {
      maskAllInputs: true,
      // Money, addresses and identity wear this class — see PortfolioPage and
      // friends. The recorder stores asterisks where the values were.
      maskTextSelector: '.ph-mask, .ph-mask *',
    },
    before_send: (event) => {
      if (!event) return null;
      // Recording payloads are megabytes of DOM; walking them would cost real
      // CPU on every batch. Their small metadata is scrubbed, the DOM itself
      // is handled by masking above.
      if (event.event === '$snapshot') {
        const url = event.properties?.$current_url;
        if (typeof url === 'string') {
          event.properties.$current_url = url.replace(SLUG_IN_PATH, '/p/:slug');
        }
        return event;
      }
      event.properties = scrubbed(event.properties) as typeof event.properties;
      if (event.$set) event.$set = scrubbed(event.$set) as typeof event.$set;
      if (event.$set_once) event.$set_once = scrubbed(event.$set_once) as typeof event.$set_once;
      return event;
    },
  });
}
