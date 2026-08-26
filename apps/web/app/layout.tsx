import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import '../src/styles.css';

const FAVICON =
  'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%2308090C%22/><circle cx=%2213%22 cy=%2216%22 r=%224%22 fill=%22none%22 stroke=%22%232BD576%22 stroke-width=%222%22/><circle cx=%2219%22 cy=%2216%22 r=%224%22 fill=%22none%22 stroke=%22%232BD576%22 stroke-width=%222%22/></svg>';

export const metadata: Metadata = {
  title: 'svinooh — every DeFi position, no exceptions',
  description:
    'Crypto portfolio tracker across EVM, Solana, TRON and Bitcoin. Tokens, LP, staking, lending — the DeFi positions other trackers miss, counted at full value.',
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
