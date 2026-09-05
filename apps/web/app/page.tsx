import type { Metadata } from 'next';
import { EMPTY_LANDING, loadLandingData } from '../src/lib/landing-data';
import { Landing } from '../src/screens/Landing';

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.DEV_API || '').replace(/\/+$/, '');

// The landing is the one address this site canonically is; stated per page
// rather than in the layout, where every route would inherit it
export const metadata: Metadata = { alternates: { canonical: '/' } };

// Rebuilt at most once a minute, and served from the cache in between. The card
// shows a public portfolio's balance, which moves on the scanner's schedule
// rather than ours, so a minute-old figure is honest — and the API sees a
// couple of requests a minute instead of a couple per visitor.
export const revalidate = 60;

/**
 * What this app is, said once in the one vocabulary every crawler shares —
 * schema.org, as JSON-LD. Serialized with `<` escaped so nothing inside the
 * JSON can ever read as a tag and close the script early.
 */
const STRUCTURED_DATA = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://svinooh.com/#org',
      name: 'svinooh',
      url: 'https://svinooh.com/',
      logo: 'https://svinooh.com/icon-512.png',
    },
    {
      '@type': 'WebApplication',
      '@id': 'https://svinooh.com/#app',
      name: 'svinooh',
      url: 'https://svinooh.com/',
      description:
        'Crypto portfolio tracker across EVM, Solana, TRON and Bitcoin. Tokens, LP, staking, lending — the DeFi positions other trackers miss, counted at full value.',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': 'https://svinooh.com/#org' },
    },
  ],
}).replace(/</g, '\\u003c');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    next: { revalidate },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export default async function LandingPage() {
  // A landing without its numbers still beats no landing: if the API is down
  // the page renders and fills itself in from the browser, which is what it did
  // before any of this was rendered up front.
  const data = await loadLandingData(get).catch(() => EMPTY_LANDING);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA }} />
      <Landing preloaded={data} />
    </>
  );
}
