import type { NextRequest } from 'next/server';

/**
 * PostHog behind our own origin, take three.
 *
 * Take one was rewrites in next.config.mjs, take two a NextResponse.rewrite
 * here with an overridden Host header. Both forwarded the browser's own Host
 * — svinooh.com — to PostHog's asset host in production: Next's proxying
 * keeps the original header, and undici refuses to let anyone set `host` by
 * hand. Cloudflare, which fronts both names, reads its own IPs in that
 * combination and refuses the loop — error 1000, every asset a 403. Only in
 * production: the dev server proxies through different code, which is why
 * every local check passed. The ingestion host is on plain AWS and never
 * cared, so events flowed while the session recorder silently failed to load.
 *
 * So no rewrite at all: this proxy makes the request itself and hands back
 * the answer. A fetch derives Host from the URL it is given — the one header
 * that started all this cannot be wrong again.
 */
const INGEST_HOST = 'eu.i.posthog.com';
const ASSET_HOST = 'eu-assets.i.posthog.com';

/**
 * Hop-by-hop and transport headers stay out of the forwarded request: host is
 * the bug this file exists for, content-length and accept-encoding describe
 * this hop's encoding rather than the next one's, and connection management
 * belongs to each connection alone.
 */
const DROP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding']);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hostname =
    pathname.startsWith('/relay/static/') || pathname.startsWith('/relay/array/')
      ? ASSET_HOST
      : INGEST_HOST;
  const target = `https://${hostname}${pathname.replace(/^\/relay/, '')}${search}`;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!DROP.has(name)) headers.set(name, value);
  }
  // X-Forwarded-For rides along untouched — it is how PostHog geolocates the
  // visitor instead of pinning everybody to this server's egress IP

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    // Required by undici to stream a request body
    // @ts-expect-error -- duplex is not in the lib's RequestInit yet
    duplex: 'half',
  });

  // The body arrives here already decoded, so the encoding headers describe
  // something that is no longer true of it
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const config = {
  matcher: '/relay/:path*',
};
