'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

/**
 * What one chart is showing the others.
 *
 * Everything here is a moment in time, never an index: the lines drawn beside
 * each other are not the same length. What could be collected and what is owed
 * have only been recorded since the release that started recording them, so
 * their series begin later than the total's and the same index is a different
 * afternoon on each.
 */
export interface ChartSyncState {
  /** Which chart is driving. Nobody follows their own broadcast. */
  source: string | null;
  /** The instant under the pointer, in ms */
  time: number | null;
  /** The measured span, in ms */
  span: { from: number; to: number } | null;
}

const NOTHING: ChartSyncState = { source: null, time: null, span: null };

interface Store {
  get(): ChartSyncState;
  subscribe(listener: () => void): () => void;
  publish(source: string, patch: Partial<Omit<ChartSyncState, 'source'>>): void;
}

const Context = createContext<Store | null>(null);

/**
 * The charts inside this read the same moment.
 *
 * Hovering one puts the crosshair on all of them and measuring a span on one
 * measures it on all of them, which is the question these cards are beside each
 * other to answer: whether what happened to one happened to the others, and
 * whether it happened at the same time.
 *
 * The moment is shared; the view is not. Each chart keeps its own scroll, so a
 * line that has less history than its neighbour is not dragged past its own
 * beginning to keep up with one that has more.
 *
 * A store rather than state, and subscribed to rather than rendered down:
 * every mouse move publishes, and a context holding state would re-render the
 * page around the charts sixty times a second to move a dotted line.
 *
 * Renders no element of its own, so it can wrap anything without becoming part
 * of the layout. A chart outside one — or inside one switched off — is simply
 * on its own.
 */
export function ChartSync({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  const store = useMemo<Store>(() => {
    let state = NOTHING;
    const listeners = new Set<() => void>();
    return {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish(source, patch) {
        state = { ...state, ...patch, source };
        for (const listener of listeners) listener();
      },
    };
  }, []);
  // Switched off, the group is withdrawn rather than torn down: the charts see
  // what a chart with no group around it sees, and keep the canvases they have
  return <Context.Provider value={enabled ? store : null}>{children}</Context.Provider>;
}

const alone = () => NOTHING;
const never = () => () => {};

/** What the other charts are showing, and how to tell them what this one is */
export function useChartSync(): { shared: ChartSyncState; publish: Store['publish'] | null } {
  const store = useContext(Context);
  const shared = useSyncExternalStore(store?.subscribe ?? never, store?.get ?? alone, store?.get ?? alone);
  return { shared, publish: store?.publish ?? null };
}

/**
 * The reading closest to this instant, or nothing when the series does not
 * reach it.
 *
 * Nothing rather than the nearest end: a card whose line starts on Tuesday has
 * no answer for Monday, and answering with Tuesday's figure under a crosshair
 * standing on Monday is the kind of wrong that is read as true.
 */
export function nearestIndex(times: number[], at: number): number | null {
  if (!times.length || at < times[0] || at > times[times.length - 1]) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  const before = lo > 0 ? lo - 1 : lo;
  return Math.abs(times[before] - at) <= Math.abs(times[lo] - at) ? before : lo;
}
