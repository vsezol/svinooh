import type { HistoryPointDto } from '@svinooh/shared';

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
