import type { StatsBlock } from '../../app/types';

export default function StatsBlockView({ block }: { block: StatsBlock }) {
  return (
    <div className="sv-a-b-stats">
      {block.items.map((item, i) => (
        <div key={i} className="sv-a-b-card sv-a-b-stat">
          <div className="sv-a-b-eyebrow">{item.label}</div>
          <div className="sv-a-b-stat-value">{item.value}</div>
          {item.sub ? (
            <div className="sv-a-b-stat-sub" data-tone={item.tone ?? 'mut'}>
              {item.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
