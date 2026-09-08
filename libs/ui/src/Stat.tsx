import type { CSSProperties, ReactNode } from 'react';

/**
 * One reading: what it is, what it says, and how it has moved.
 *
 * The smallest way to state a number so it can be scanned rather than read —
 * a label nobody has to parse, the figure in the mono face every figure in
 * this product wears, and the change under it in the colour of its direction.
 *
 * It came out of the assistant putting four of them under an answer, but it is
 * the shape the portfolio's own headline cards have always had, and having it
 * once is what stops the two drifting into two.
 */

export type StatTone = 'up' | 'down' | 'flat';

export interface StatProps {
  label: string;
  value: ReactNode;
  /** What changed, and over what — "+6.05% · 7D". Left out, the row is not drawn. */
  delta?: ReactNode;
  tone?: StatTone;
}

const toneColor = (tone: StatTone): string =>
  tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--mut)';

export function Stat({ label, value, delta, tone = 'flat' }: StatProps) {
  return (
    <div className="ui-stat">
      <div className="ui-stat-label mono">{label}</div>
      <div className="ui-stat-value mono">{value}</div>
      {delta === undefined ? null : (
        <div className="ui-stat-delta mono" style={{ color: toneColor(tone) }}>
          {delta}
        </div>
      )}
    </div>
  );
}

/**
 * Several of them, in as many columns as the space can hold.
 *
 * `columns` is what the caller knows and the grid cannot: a phone gets two, a
 * desktop four, and the same four readings should not reflow into a column of
 * one because the container happens to be narrow.
 */
export function StatGrid({
  columns,
  children,
  style,
}: {
  columns: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="ui-stat-grid"
      style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, ...style }}
    >
      {children}
    </div>
  );
}
