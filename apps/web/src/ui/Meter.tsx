/**
 * A quantity on a track: how full something is, of what there is.
 *
 * It once also carried a `band`/`mark` mode for the liquidity range bar; that
 * grew into a full instrument of its own (axis, ruled fill, ticks, needle) and
 * lives in RangeBar now. What is left is the one reading the Tron resource
 * meters need.
 */
export function Meter({
  value = 1,
  tone = 'var(--acc)',
}: {
  /** 0 to 1 */
  value?: number;
  /** Any colour the caller can justify — usually var(--up), var(--down), var(--acc) */
  tone?: string;
}) {
  const clamp = (n: number) => Math.min(Math.max(n, 0), 1);
  return (
    <div className="ui-meter" style={{ ['--meter-tone' as string]: tone }}>
      <div className="ui-meter-fill" style={{ width: `${clamp(value) * 100}%` }} />
    </div>
  );
}
