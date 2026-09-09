import type { PortfolioRef } from '../app/types';

interface Props {
  portfolio?: PortfolioRef;
  onClick: () => void;
}

/**
 * The design's mark for "this is what the answers are about": a target, not a
 * status light. A dot beside a name reads as online/offline — which is not
 * what a portfolio is doing.
 */
const TARGET = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Shows which portfolio grounds the answers; opens the switcher. */
export function GroundingChip({ portfolio, onClick }: Props) {
  return (
    <button type="button" className="sv-a-c-ground" data-empty={portfolio ? undefined : 'true'} onClick={onClick}>
      <span className="sv-a-c-ground-mark">{TARGET}</span>
      <span className="sv-a-c-ground-name">{portfolio ? portfolio.name : 'No portfolio'}</span>
      <span className="sv-a-c-ground-chev">{CHEVRON}</span>
    </button>
  );
}
