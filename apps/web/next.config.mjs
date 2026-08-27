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
  async rewrites() {
    const target = process.env.DEV_API?.replace(/\/+$/, '');
    return target ? [{ source: '/api/:path*', destination: `${target}/api/:path*` }] : [];
  },
};
