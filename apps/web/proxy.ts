import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * PostHog behind our own origin, take two.
 *
 * The first take was three rewrites in next.config.mjs. In production they
 * forwarded the browser's own Host header — svinooh.com — to PostHog's asset
 * host, and both of those names live behind Cloudflare. Cloudflare, asked for
 * svinooh.com on a connection meant for eu-assets.i.posthog.com, reads its own
 * IPs in the answer and refuses the loop: error 1000, every asset a 403. The
 * ingestion host is on plain AWS and never noticed, which is why events
 * flowed while the recorder script did not.
 *
 * A proxy can say what a rewrite cannot: which Host to carry. Same paths,
 * same destinations, the header set to the name actually being visited.
 */
const INGEST_HOST = 'eu.i.posthog.com';
const ASSET_HOST = 'eu-assets.i.posthog.com';

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const pathname = url.pathname;
  const hostname =
    pathname.startsWith('/relay/static/') || pathname.startsWith('/relay/array/')
      ? ASSET_HOST
      : INGEST_HOST;

  const headers = new Headers(request.headers);
  headers.set('host', hostname);

  url.protocol = 'https';
  url.hostname = hostname;
  url.port = '443';
  url.pathname = pathname.replace(/^\/relay/, '');

  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: '/relay/:path*',
};
