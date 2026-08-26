import type { HistoryDto, PortfolioDto, PublicPortfolioDto } from '@svinooh/shared';

/** Everything the landing needs to render its first frame */
export interface LandingData {
  pubs: PublicPortfolioDto[];
  demo: PortfolioDto | null;
  history: { values: number[]; times: number[] } | null;
}

/** Where the server leaves the data it rendered with */
export const PRELOAD_KEY = '__SVINOOH__';

export const EMPTY_LANDING: LandingData = { pubs: [], demo: null, history: null };

/**
 * Loads the landing in two hops — the public list decides which portfolio the
 * demo card shows, and only then can it be fetched. In the browser that is two
 * round trips of an empty card; done on the server it is two fast hops inside
 * the datacentre and the visitor sees neither.
 *
 * Everything here is public by definition: the list, a public portfolio, its
 * history. Nothing identifying anybody goes into the HTML.
 */
export async function loadLandingData(get: <T>(path: string) => Promise<T>): Promise<LandingData> {
  const pubs = await get<PublicPortfolioDto[]>('/portfolios/public?limit=12');
  const top = pubs[0]?.slug;
  if (!top) return { pubs, demo: null, history: null };

  const [demo, history] = await Promise.all([
    get<PortfolioDto>(`/portfolios/${top}`).catch(() => null),
    get<HistoryDto>(`/portfolios/${top}/history?range=30d`)
      .then((h) => ({
        values: h.points.map((p) => p.usd),
        times: h.points.map((p) => new Date(p.t).getTime()),
      }))
      .catch(() => null),
  ]);
  return { pubs, demo, history };
}

/** What the server rendered with, so the client hydrates against the same thing */
export function preloadedLanding(): LandingData | null {
  if (typeof window === 'undefined') return null;
  const data = (window as unknown as Record<string, LandingData | undefined>)[PRELOAD_KEY];
  return data ?? null;
}
