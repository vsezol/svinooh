import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Manrope } from 'next/font/google';
import { Providers } from './providers';
import '../src/styles.css';

// Served from this origin and arriving with the page: the old <link> to Google
// Fonts was a render-blocking round trip to a third party on every first
// visit. styles.css points --sans and --mono at the variables declared here.
const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-mono',
});

const TITLE = 'svinooh — every DeFi position, no exceptions';
const DESCRIPTION =
  'Crypto portfolio tracker across EVM, Solana, TRON and Bitcoin. Tokens, LP, staking, lending — the DeFi positions other trackers miss, counted at full value.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
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
  // Relative URLs in metadata resolve against this. The canonical itself lives
  // on each page — set here it would be inherited by every route, and a
  // portfolio claiming to canonically be the landing is a lie to a crawler.
  metadataBase: new URL('https://svinooh.com'),
  // What a pasted link unfurls into. The card image is drawn next door in
  // opengraph-image.tsx; Next wires it into og:image and twitter:image on
  // every route that doesn't draw its own.
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
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
    <html lang="en" className={`${manrope.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
