import { TagButton } from './Tag';

export interface Segment<T extends string> {
  key: T;
  label: string;
}

/**
 * Pick one of a few, as a row of pills.
 *
 * Covers the two places that were the same control written twice: the chart's
 * period switch and the position filter. They differ only in what being chosen
 * looks like, which is the `tone` — `neutral` for a change of view, `accent`
 * for a filter narrowing what is on the page.
 *
 * Deliberately NOT covering the phone's tab bar or the desktop rail. Those pick
 * one of a few as well, but their selection is an animated indicator wired to a
 * swipe pager and a vertical icon rail respectively; folding them in here would
 * mean a component with two mechanisms and a flag choosing between them.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  tone = 'neutral',
  size = 'sm',
  label,
}: {
  items: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (key: T) => void;
  tone?: 'neutral' | 'accent';
  size?: 'sm' | 'md';
  /** What the group as a whole is choosing between */
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
      {items.map((item) => (
        <TagButton
          key={item.key}
          variant={tone === 'accent' ? 'outline' : 'bare'}
          size={size}
          tone={tone}
          active={item.key === value}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </TagButton>
      ))}
    </div>
  );
}
