import type { TraceBlock } from '../../app/types';

const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

const Chevron = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * What the agent is doing, while it is doing it.
 *
 * The wait used to be a pulsing dot, which says only that something is
 * happening. This says what: the portfolio being read, the positions being
 * counted, the health factor being checked — each with the time it took. A
 * person waiting on work they can see is waiting on something; a person
 * waiting on a spinner is being kept.
 *
 * Then it folds to one line. The steps mattered while they were running and
 * are clutter above a finished answer, so what stays is the receipt — how many
 * and how long — and it opens again if anybody wants it.
 */
export default function TraceBlockView({
  block,
  onToggle,
}: {
  block: TraceBlock;
  onToggle?: () => void;
}) {
  if (block.collapsed) {
    return (
      <button type="button" className="sv-a-b-trace-sum mono" onClick={onToggle}>
        <Tick />
        <span>{block.summary}</span>
        <Chevron />
      </button>
    );
  }

  return (
    <div className="sv-a-b-trace">
      {block.steps.map((step, i) => (
        <div key={i} className="sv-a-b-trace-row mono" data-state={step.state}>
          <span className="sv-a-b-trace-mark">
            {step.state === 'done' ? <Tick /> : null}
            {step.state === 'running' ? <span className="sv-a-b-trace-spin" /> : null}
            {step.state === 'waiting' ? <span className="sv-a-b-trace-dot" /> : null}
          </span>
          <span className="sv-a-b-trace-label">{step.label}</span>
          {step.time ? <span className="sv-a-b-trace-time">{step.time}</span> : null}
        </div>
      ))}
    </div>
  );
}
