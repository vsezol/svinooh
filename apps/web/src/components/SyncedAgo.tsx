import { useEffect, useState } from 'react';
import { syncedLabel } from '../lib/format';

/** How often the label catches up with the clock */
const TICK_MS = 10_000;

/**
 * How long ago the portfolio was last scanned, kept honest.
 *
 * The label was rendered once and then left alone, so a page open for half an
 * hour went on insisting the data had arrived a moment ago. It is a clock, so
 * it ticks.
 */
export function SyncedAgo({ iso }: { iso: string | null }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      // Only while the page is being looked at — a hidden tab has nobody to
      // mislead, and it catches up the moment it comes back
      if (!document.hidden) tick((n) => n + 1);
    }, TICK_MS);
    const onVisible = () => !document.hidden && tick((n) => n + 1);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <>SYNCED {syncedLabel(iso).toUpperCase()}</>;
}
