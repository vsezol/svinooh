import type { MetadataRoute } from 'next';

/**
 * What the phone needs to keep svinooh as an app rather than a bookmark: its
 * own icon, its own window with no address bar, and a background colour so the
 * splash isn't a white flash on the way into a dark page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'svinooh — every DeFi position',
    short_name: 'svinooh',
    description:
      'Crypto portfolio tracker across EVM, Solana, TRON and Bitcoin. Tokens, LP, staking, lending — the DeFi positions other trackers miss, counted at full value.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08090c',
    theme_color: '#08090c',
    categories: ['finance', 'utilities'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Cropped to a circle on Android, so it carries its own wide margin
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
