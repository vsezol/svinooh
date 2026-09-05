import type { MetadataRoute } from 'next';

/**
 * The origin's own answer to "may I crawl this" — every crawler welcome,
 * search and AI alike. Cloudflare's managed robots.txt used to answer for
 * this domain and turned the AI crawlers away at the doorstep; with that
 * override off, this file is what they read. /auth is a machine conversation
 * mid-handshake and /relay is the analytics proxy — neither is a page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/auth/', '/relay/'] }],
    sitemap: 'https://svinooh.com/sitemap.xml',
  };
}
