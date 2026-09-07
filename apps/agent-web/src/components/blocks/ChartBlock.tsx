import type { ChartBlock } from '../../app/types';

const VIEW_W = 100;
const VIEW_H = 100;
/* Inset in viewBox units: under preserveAspectRatio="none" the non-scaling
   2px stroke would otherwise clip in half at the min/max extremes. */
const PAD_Y = 4;

/* Axis labels follow the canvas style: $134.8k, not full figures. */
function compact(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}b`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

interface Plot {
  line: string;
  area: string;
  min: number;
  max: number;
}

function buildPlot(values: number[]): Plot | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  /* A single point still reads as a flat line across the full width. */
  const plotted = values.length === 1 ? [values[0], values[0]] : values;
  const step = VIEW_W / (plotted.length - 1);
  const pts = plotted.map((v, i) => {
    const x = (i * step).toFixed(2);
    const y = (VIEW_H - PAD_Y - ((v - min) / range) * (VIEW_H - PAD_Y * 2)).toFixed(2);
    return `${x},${y}`;
  });
  const line = `M${pts.join(' L')}`;
  return { line, area: `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`, min, max };
}

export default function ChartBlockView({ block }: { block: ChartBlock }) {
  const plot = buildPlot(block.points.map((p) => p.v));
  return (
    <div className="sv-a-b-card sv-a-b-chart">
      <div className="sv-a-b-eyebrow">{block.title}</div>
      {block.delta ? (
        <div className="sv-a-b-chart-delta" data-tone={block.deltaTone}>
          {block.delta}
        </div>
      ) : null}
      {plot ? (
        <div className="sv-a-b-chart-plot">
          <div className="sv-a-b-chart-main">
            <svg
              className="sv-a-b-chart-svg"
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={block.title}
            >
              <path d={plot.area} fill="currentColor" fillOpacity={0.13} stroke="none" />
              <path
                d={plot.line}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {block.xTicks?.length ? (
              <div className="sv-a-b-chart-x">
                {block.xTicks.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="sv-a-b-chart-y">
            <span>{compact(plot.max)}</span>
            <span>{compact((plot.min + plot.max) / 2)}</span>
            <span>{compact(plot.min)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
