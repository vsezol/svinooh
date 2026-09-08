import { lazy, Suspense } from 'react';
import { useDesktop } from '../../app/useDesktop';
import type { ChartBlock } from '../../app/types';

/**
 * Tall enough to drag across and read something off. Below about 120px the
 * line is a decoration and the measuring gesture has nowhere to land.
 */
const HEIGHT = { phone: '120px', desktop: '140px' };

/**
 * A chart in an answer — the product's own chart, not a picture of one.
 *
 * It used to be a static SVG: a line, two axis labels, nothing to do. Which
 * raised the fair question of why bother. A chart you cannot drag, measure or
 * read a value off is a screenshot, and the assistant putting a screenshot of
 * the portfolio's chart next to a sentence about it is worse than putting
 * nothing, because it looks like the real one.
 *
 * So it is the real one. Same component, same gestures: drag to scroll through
 * the history, shift-drag or two fingers to measure a span, hover to read the
 * value under the pointer. The assistant decides which readings to show and
 * what to say about them; how a chart behaves is not its business and never
 * was.
 *
 * Loaded on demand because the charting library is the largest thing in this
 * bundle and most turns are a paragraph of text. It arrives when an answer
 * actually has a chart in it.
 */
const AreaChart = lazy(() =>
  import('@svinooh/ui/AreaChart').then((m) => ({ default: m.AreaChart })),
);

export default function ChartBlockView({ block }: { block: ChartBlock }) {
  const desktop = useDesktop();
  const height = desktop ? HEIGHT.desktop : HEIGHT.phone;
  const values = block.points.map((p) => p.v);
  const times = block.points.map((p) => p.t);

  return (
    <div className="sv-a-b-card sv-a-b-chart">
      <div className="sv-a-b-chart-head">
        <span className="sv-a-b-eyebrow">{block.title}</span>
        {block.delta ? (
          <span className="sv-a-b-chart-delta mono" data-tone={block.deltaTone ?? 'mut'}>
            {block.delta}
          </span>
        ) : null}
      </div>
      {/* The placeholder holds the height the chart will take, so an answer
          does not jump when the library lands. A number rather than a
          percentage: the chart sizes its canvas from this box, and a box that
          resolves against a parent with no height resolves to nothing. */}
      <Suspense fallback={<div style={{ height, marginTop: 10 }} />}>
        <div style={{ marginTop: 10 }}>
          <AreaChart values={values} times={times} period={block.period} height={height} framed={false} />
        </div>
      </Suspense>
    </div>
  );
}
