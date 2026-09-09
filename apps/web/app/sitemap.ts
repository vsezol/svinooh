import type { MetadataRoute } from 'next';
import { EVM_CHAINS } from '../src/lib/evm-chains';

/**
 * Only pages that mean the same thing to every visitor. A portfolio is
 * somebody's money behind a slug — opened by the link its owner handed out,
 * never listed for a crawler to walk. The per-network pages come from the
 * same list that renders them, so the two cannot drift apart.
 */
const PAGES: { path: string; changeFrequency: 'daily' | 'weekly'; priority: number }[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  // The app's front door, and the one page that IS the product: a chat anybody
  // can start without an account. A named conversation under it (/ai/c/<id>)
  // is not here — that is one person's, like a portfolio.
  { path: '/ai', changeFrequency: 'daily', priority: 0.9 },
  { path: '/pro', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/faq', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/alternatives', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/alternatives/zapper', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/alternatives/debank', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/alternatives/zerion', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/alternatives/coinstats', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/chains/evm', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/solana', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/tron', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/bitcoin', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/chains/hyperliquid', changeFrequency: 'weekly', priority: 0.7 },
  ...EVM_CHAINS.map((c) => ({ path: `/chains/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.6 })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `https://svinooh.com${path === '/' ? '/' : path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
