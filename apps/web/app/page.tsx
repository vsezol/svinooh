import { EMPTY_LANDING, loadLandingData } from '../src/lib/landing-data';
import { Landing } from '../src/screens/Landing';

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.DEV_API || '').replace(/\/+$/, '');

// Rebuilt at most once a minute, and served from the cache in between. The card
// shows a public portfolio's balance, which moves on the scanner's schedule
// rather than ours, so a minute-old figure is honest — and the API sees a
// couple of requests a minute instead of a couple per visitor.
export const revalidate = 60;

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
  return <Landing preloaded={data} />;
}
