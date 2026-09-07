import type { BarsBlock } from '../../app/types';

export default function BarsBlockView({ block }: { block: BarsBlock }) {
  return (
    <div className="sv-a-b-card sv-a-b-bars">
      {block.items.map((item, i) => (
        <div key={i} className="sv-a-b-bar">
          <div className="sv-a-b-bar-head">
            <span className="sv-a-b-bar-label">{item.label}</span>
            <span className="sv-a-b-bar-value">{item.value}</span>
          </div>
          <div className="sv-a-b-bar-track">
            <div
              className="sv-a-b-bar-fill"
              style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
            />
          </div>
          {item.sub ? <div className="sv-a-b-bar-sub">{item.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
