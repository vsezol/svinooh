/**
 * A track with something read off it. Two readings, and the props name them:
 *
 *  - a QUANTITY: `value` is how full it is (energy left, bandwidth left)
 *  - a BAND: `band` is a segment of a longer axis, and `mark` is where on that
 *    axis something currently sits
 *
 * The band is a segment rather than the whole track on purpose. A track filled
 * edge to edge is the visual language of a slider at maximum — a control,
 * asking to be dragged. Inset on a neutral axis it reads as what it is: a
 * region something can be inside or outside of.
 */
export function Meter({
  value = 1,
  tone = 'var(--acc)',
  band,
  mark,
}: {
  /** 0 to 1 — the quantity reading; ignored when `band` is given */
  value?: number;
  /** Any colour the caller can justify — usually var(--up), var(--down), var(--acc) */
  tone?: string;
  /** A segment of the axis, both ends 0 to 1 */
  band?: { from: number; to: number };
  /** 0 to 1, or null for a bar with nothing on it */
  mark?: number | null;
}) {
  const clamp = (n: number) => Math.min(Math.max(n, 0), 1);
  return (
    <div className="ui-meter" style={{ ['--meter-tone' as string]: tone }}>
      {band ? (
        <div
          className="ui-meter-band"
          style={{ left: `${clamp(band.from) * 100}%`, width: `${(clamp(band.to) - clamp(band.from)) * 100}%` }}
        />
      ) : (
        <div className="ui-meter-fill" style={{ width: `${clamp(value) * 100}%` }} />
      )}
      {mark === null || mark === undefined ? null : (
        <div className="ui-meter-mark" style={{ left: `${clamp(mark) * 100}%` }} />
      )}
    </div>
  );
}
