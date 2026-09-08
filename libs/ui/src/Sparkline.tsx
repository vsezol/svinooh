/** Keeps the markup small: the landing's chart is 130px tall, not a workspace */
const MAX_POINTS = 120;
const VIEW_W = 1000;
const VIEW_H = 260;

function path(values: number[]): { line: string; area: string } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  // A little headroom top and bottom so the line never touches the edge
  const y = (v: number): number => VIEW_H - 12 - ((v - lo) / span) * (VIEW_H - 24);
  const x = (i: number): number => (i / (values.length - 1 || 1)) * VIEW_W;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z` };
}

/**
 * A line to be looked at rather than interrogated, as plain SVG.
 *
 * The portfolio page uses Lightweight Charts, which draws to a canvas — a
 * canvas cannot exist until JavaScript runs, so the first thing a visitor saw
 * was an empty box that filled in a moment later, and the page moved under
 * them. This one is markup: it is in the HTML the server sends, it is painted
 * with the first frame, and hydration has nothing to do to it.
 *
 * Two places want that now — the landing, and a chart the assistant puts in a
 * message — which is what brought it into the kit. Neither is a workspace:
 * there is nothing here to drag, measure or hover, and both are better for it.
 */
export function Sparkline({
  values,
  height,
  /** Faint horizontal rules behind the line, for a chart that sits in a card */
  gridlines = 0,
  strokeWidth = 2,
}: {
  values: number[];
  height: number;
  gridlines?: number;
  strokeWidth?: number;
}) {
  if (values.length < 2) return <div style={{ height }} />;

  // Evenly thinned, always keeping the last point — the end of the line is the
  // one place a wrong value would be noticed
  const step = Math.ceil(values.length / MAX_POINTS);
  const points = step > 1 ? values.filter((_, i) => i % step === 0) : values.slice();
  if (points[points.length - 1] !== values[values.length - 1]) points.push(values[values.length - 1]);

  const { line, area } = path(points);
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sv-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Behind the line, evenly spaced, and never on the edges — a rule at the
          top or bottom of the box reads as a border rather than a gridline. */}
      {Array.from({ length: gridlines }, (_, i) => {
        const y = (VIEW_H / (gridlines + 1)) * (i + 1);
        return (
          <line
            key={i}
            x1="0"
            y1={y}
            x2={VIEW_W}
            y2={y}
            stroke="var(--line)"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <path d={area} fill="url(#sv-spark)" />
      {/* Non-scaling: preserveAspectRatio="none" stretches the box, and without
          this the line would be stretched with it */}
      <path
        d={line}
        fill="none"
        stroke="var(--acc)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
