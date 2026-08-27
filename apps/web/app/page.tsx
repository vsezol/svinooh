import { EMPTY_LANDING, loadLandingData } from '../src/lib/landing-data';
import { Landing } from '../src/screens/Landing';

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.DEV_API || '').replace(/\/+$/, '');

/**
 * Built for the visitor who asked for it, never handed on to the next one.
 *
 * This page used to be rebuilt once a minute and served from the cache in
 * between, which is a fine trade for a balance: it moves on the scanner's
 * schedule, and a minute-old figure is honest. It is not a fine trade for the
 * list beside it. That list says who is visible, and somebody who has just
 * taken their portfolio private is owed the answer now, not at the end of a
 * window they cannot see and did not agree to.
 */
export const dynamic = 'force-dynamic';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    cache: 'no-store',
    // Short, because nothing waits on this that the browser cannot fetch for
    // itself a moment later. A landing that hangs while the API thinks is worse
    // than one that arrives empty and fills in.
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export default async function LandingPage() {
  // A landing without its numbers still beats no landing: if the API is down
  // the page renders and fills itself in from the browser, which is what it did
  // before any of this was rendered up front.
  const data = await loadLandingData(get).catch(() => EMPTY_LANDING);
  return <Landing preloaded={data} />;
}
