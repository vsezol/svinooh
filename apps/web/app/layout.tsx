import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import '../src/styles.css';

export const metadata: Metadata = {
  title: 'svinooh — every DeFi position, no exceptions',
  description:
    'Crypto portfolio tracker across EVM, Solana, TRON and Bitcoin. Tokens, LP, staking, lending — the DeFi positions other trackers miss, counted at full value.',
  // One set of icons everywhere — the tab, the home screen, the app window —
  // so the mark can never be one thing in one place and another somewhere else
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon-180.png',
  },
  // Installed to a home screen it is an app, and an app has a name, not a
  // headline with a tagline in it
  applicationName: 'svinooh',
  appleWebApp: { capable: true, title: 'svinooh', statusBarStyle: 'black-translucent' },
  // Relative URLs in metadata need a base; the canonical link needs one too
  metadataBase: new URL('https://svinooh.com'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The page paints under the notch and the home indicator; the layout keeps
  // itself clear of them with env(safe-area-inset-*)
  viewportFit: 'cover',
  // Pinching the page would fight the chart's own two-finger gesture, and a
  // portfolio has nothing to zoom into
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f4f6' },
    { media: '(prefers-color-scheme: dark)', color: '#08090c' },
  ],
};

/**
 * Applies the visitor's saved theme before anything is painted. It has to be
 * inline and it has to run first: the page is rendered on the server, which has
 * no idea which theme they keep, so without this a light-theme visitor gets a
 * dark page for one frame.
 */
const THEME_SCRIPT = `try{if(localStorage.getItem('svinooh_theme')==='light'){document.documentElement.dataset.theme='light'}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
