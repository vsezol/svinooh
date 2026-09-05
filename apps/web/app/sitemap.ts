import type { MetadataRoute } from 'next';

/**
 * Only pages that mean the same thing to every visitor: the landing and the
 * Pro pitch. A portfolio is somebody's money behind a slug — opened by the
 * link its owner handed out, never listed for a crawler to walk.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://svinooh.com/', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: 'https://svinooh.com/pro', lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
  ];
}
