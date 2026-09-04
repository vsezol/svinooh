/** @type {import('next').NextConfig} */
export default {
  // A self-contained server directory, so the runtime image carries what it
  // needs and not the whole node_modules tree
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  // Local development against a deployed API: with DEV_API set, /api is
  // proxied there, so the browser talks to its own origin and CORS never comes
  // into it. Unset in production, where the browser calls the API directly.
  // Note that Next resolves this at build time — a production build made
  // without DEV_API has no proxy, whatever the environment says when it runs.
  //
  // /relay/* is PostHog behind our own origin. Adblockers cut analytics by
  // domain, and a crypto audience runs them more than most — proxied like
  // this, the counter's requests are indistinguishable from the site's own.
  // Assets and ingestion live on different PostHog hosts, hence three rules.
  async rewrites() {
    const target = process.env.DEV_API?.replace(/\/+$/, '');
    return [
      ...(target ? [{ source: '/api/:path*', destination: `${target}/api/:path*` }] : []),
      { source: '/relay/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/relay/array/:path*', destination: 'https://eu-assets.i.posthog.com/array/:path*' },
      { source: '/relay/:path*', destination: 'https://eu.i.posthog.com/:path*' },
    ];
  },
  // PostHog's ingestion endpoints end in a slash; Next's default redirect
  // would answer them with a 308 the SDK does not follow
  skipTrailingSlashRedirect: true,
};
