import type { MetadataRoute } from 'next';

/**
 * Only pages that mean the same thing to every visitor. A portfolio is
 * somebody's money behind a slug — opened by the link its owner handed out,
 * never listed for a crawler to walk.
 */
const PAGES: { path: string; changeFrequency: 'daily' | 'weekly'; priority: number }[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/pro', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/faq', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/alternatives', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/alternatives/zapper', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/alternatives/debank', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/alternatives/zerion', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/alternatives/coinstats', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/chains/solana', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/tron', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/bitcoin', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/hyperliquid', changeFrequency: 'weekly', priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `https://svinooh.com${path === '/' ? '/' : path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
