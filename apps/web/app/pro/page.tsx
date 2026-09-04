import type { ProOfferDto } from '@svinooh/shared';
import { ProPage } from '../../src/screens/ProPage';

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.DEV_API || '').replace(/\/+$/, '');

export const metadata = { title: 'Svinooh.Pro' };

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
