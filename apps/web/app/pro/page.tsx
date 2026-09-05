import type { Metadata } from 'next';
import type { ProOfferDto } from '@svinooh/shared';
import { ProPage } from '../../src/screens/ProPage';

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.DEV_API || '').replace(/\/+$/, '');

const TITLE = 'Svinooh.Pro';
const DESCRIPTION =
  'The paid tier of svinooh: higher limits on portfolios, wallets, history, alerts and AI — prepaid by the month.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/pro' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/pro' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// Same shape as the landing: the offer is prerendered so the page arrives with
// its prices in the HTML, and rebuilt at most once a minute — the knobs it
// quotes are operator tunables, not market data.
export const revalidate = 60;

export default async function Pro() {
  const offer = await fetch(`${API}/api/billing/offer`, {
    next: { revalidate },
    signal: AbortSignal.timeout(6000),
  })
    .then((res) => (res.ok ? (res.json() as Promise<ProOfferDto>) : null))
    // A pitch without its numbers still beats no page: the browser re-asks
    .catch(() => null);
  return <ProPage preloaded={offer} />;
}
