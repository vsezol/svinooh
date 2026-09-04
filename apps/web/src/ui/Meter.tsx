/**
 * A track with something read off it.
 *
 * Two of these were drawn by hand — the Tron resource bars and the liquidity
 * range bar — with the same 4px rounded track and different ideas about the
 * rest. They are the same shape doing two jobs, which the props name:
 *
 *  - a QUANTITY: `value` is how full it is (energy left, bandwidth left)
 *  - a BAND: `soft` colours the whole track, and `mark` says where on it
 *    something currently sits, which is the only number that matters
 */
export function Meter({
  value = 1,
  tone = 'var(--acc)',
  soft,
  mark,
  markTitle,
}: {
  /** 0 to 1 */
  value?: number;
  /** Any colour the caller can justify — usually var(--up), var(--down), var(--acc) */
  tone?: string;
  soft?: boolean;
  /** 0 to 1, or null for a bar with nothing on it */
  mark?: number | null;
  markTitle?: string;
}) {
  const clamp = (n: number) => Math.min(Math.max(n, 0), 1);
  return (
    <div className="ui-meter" style={{ ['--meter-tone' as string]: tone }}>
      <div className="ui-meter-fill" data-soft={soft ? 'true' : undefined} style={{ width: `${clamp(value) * 100}%` }} />
      {mark === null || mark === undefined ? null : (
        <div className="ui-meter-mark" title={markTitle} style={{ left: `${clamp(mark) * 100}%` }} />
      )}
    </div>
  );
}
