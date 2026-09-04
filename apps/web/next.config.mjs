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
  // PostHog's /relay/* lives in proxy.ts, not here: a rewrite forwards the
  // browser's Host header, and Cloudflare answers that with a 403 — the whole
  // story is told over there.
  async rewrites() {
    const target = process.env.DEV_API?.replace(/\/+$/, '');
    return target ? [{ source: '/api/:path*', destination: `${target}/api/:path*` }] : [];
  },
  // PostHog's ingestion endpoints end in a slash; Next's default redirect
  // would answer them with a 308 the SDK does not follow
  skipTrailingSlashRedirect: true,
};
