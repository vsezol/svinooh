import type { HistoryDto, HistoryPointDto, HistoryRange } from '@svinooh/shared';
import { api, whenNetworkIdle } from './api';

/** A line ready to be drawn: values and the moments they were read at */
export interface Series {
  values: number[];
  times: number[];
}

export const EMPTY_SERIES: Series = { values: [], times: [] };

/**
 * One reading out of each point, from where the readings begin.
 *
 * What could be collected and what is owed have only been recorded since the
 * release that started recording them, so an older point answers `null` for
 * them. A line drawn through those as zeroes would say a portfolio owed nothing
 * before we were counting, which is a claim nobody made — so the line starts
 * after the last gap instead, and is simply shorter than the total's.
 */
export function seriesOf(
  points: HistoryPointDto[],
  read: (point: HistoryPointDto) => number | null | undefined,
): Series {
  // `undefined` as well as null: an API that predates the reading does not send
  // the field at all, and during a rollout that is every answer for a while
  const known = points.map((point) => read(point) ?? null);

  let from = 0;
  for (let i = 0; i < known.length; i++) if (known[i] === null) from = i + 1;

  const values: number[] = [];
  const times: number[] = [];
  for (let i = from; i < points.length; i++) {
    values.push(known[i] as number);
    times.push(new Date(points[i].t).getTime());
  }
  return { values, times };
}

/** The three lines one request answers with, for one scope and one period */
export interface History {
  total: Series;
  claimable: Series;
  debt: Series;
}

export const EMPTY_HISTORY: History = { total: EMPTY_SERIES, claimable: EMPTY_SERIES, debt: EMPTY_SERIES };

/**
 * Every period that has been fetched, for as long as the tab is open.
 *
 * A period is a window width over the same readings, so switching between them
 * is a question the server has already answered. Keeping the answer is what
 * makes the second press of a period button instant — and, more to the point,
 * what stops the chart drawing one period's readings inside another period's
 * window on the way there.
 *
 * Entries are kept past the sync they came from, deliberately. A new scan adds
 * one reading to the right-hand edge; on a 30-day chart at a two-hour
 * resolution that is the same picture twenty-three times out of twenty-four, so
 * throwing all five away every few minutes would be a lot of bandwidth spent
 * redrawing what is already on screen. Instead the stale one is shown at once
 * and replaced behind it — same period, same window, a few more points.
 */
interface Entry {
  /** The sync this was read at, so a caller can tell whether it is current */
  stamp: string | null;
  data: History;
}

/**
 * Four scopes' worth of periods. A portfolio of seven wallets could otherwise
 * accumulate thirty-five series of a thousand points apiece, which is real
 * memory spent on wallets the reader looked at once.
 */
const MAX_ENTRIES = 20;

const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<History>>();

const keyOf = (slug: string, scope: string, period: HistoryRange): string =>
  `${slug}|${scope}|${period}`;

const pathOf = (slug: string, scope: string, period: HistoryRange): string =>
  scope === 'all'
    ? `/portfolios/${slug}/history?range=${period}`
    : `/portfolios/${slug}/wallets/${scope}/history?range=${period}`;

function keep(key: string, entry: Entry): void {
  cache.delete(key); // re-inserted at the end, so eviction is by age of last read
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * What is already known about this period, current or not.
 *
 * The caller wants it either way: something a few minutes old, drawn in the
 * right window, beats the right answer arriving after a jump.
 */
export function cachedHistory(slug: string, scope: string, period: HistoryRange): History | null {
  return cache.get(keyOf(slug, scope, period))?.data ?? null;
}

/**
 * One period's history, read at the given sync.
 *
 * Returns the cached copy when it was read at that same sync, and fetches
 * otherwise. Concurrent callers of the same thing share one request: the
 * prefetch below and a reader pressing that very button are the common case,
 * and two requests for one answer is what this is here to avoid.
 */
export function loadHistory(
  slug: string,
  scope: string,
  period: HistoryRange,
  stamp: string | null,
): Promise<History> {
  const key = keyOf(slug, scope, period);
  const entry = cache.get(key);
  if (entry && entry.stamp === stamp) return Promise.resolve(entry.data);
  const already = pending.get(key);
  if (already) return already;

  const request = api<HistoryDto>(pathOf(slug, scope, period))
    .then((h) => {
      const data: History = {
        total: seriesOf(h.points, (p) => p.usd),
        claimable: seriesOf(h.points, (p) => p.claimableUsd),
        debt: seriesOf(h.points, (p) => p.debtUsd),
      };
      keep(key, { stamp, data });
      return data;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

/**
 * Fetches the periods nobody has asked for yet, one at a time, each time the
 * page has nothing else in the air.
 *
 * This is the whole reason a period switch can be instant. It is also why it
 * waits: a prefetch buys a click at the cost of a request nobody is waiting
 * for — worth it when the network is free, never worth it when it is not.
 *
 * Only periods with nothing cached at all. Refreshing a stale one is the job of
 * whoever puts it on screen, which keeps a tab left open all afternoon from
 * re-reading five charts every time a scan lands.
 */
export async function prefetchHistory(
  slug: string,
  scope: string,
  periods: HistoryRange[],
  stamp: string | null,
  cancelled: () => boolean,
): Promise<void> {
  for (const period of periods) {
    if (cancelled()) return;
    if (cachedHistory(slug, scope, period)) continue;
    await whenNetworkIdle();
    if (cancelled()) return;
    // A period that will not load is a period the reader waits for the old way
    await loadHistory(slug, scope, period, stamp).catch(() => undefined);
  }
}
