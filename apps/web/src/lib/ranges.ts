import type { HistoryRange } from '@svinooh/shared';

/**
 * A period is the width of the chart's window, not the whole of what it is
 * given. 24H means a day fills the width and the days before it are scrolled
 * back to; the API hands over several windows' worth so there is something on
 * either side to reach.
 *
 * `all` has no width — it is the whole history at a glance, and nothing is off
 * screen to scroll to.
 */
export const WINDOW_MS: Record<HistoryRange, number | null> = {
  '1h': 3600e3,
  '24h': 24 * 3600e3,
  '7d': 7 * 86400e3,
  '30d': 30 * 86400e3,
  all: null,
};

/**
 * The periods the buttons offer, in the order they are shown. 1H is only worth
 * pressing once the readings are closer together than an hour is wide, which
 * is on the sync interval rather than on us.
 */
export const PERIODS: Array<{ key: HistoryRange; label: string }> = [
  { key: '1h', label: '1H' },
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'ALL' },
];
