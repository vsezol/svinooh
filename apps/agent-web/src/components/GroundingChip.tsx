import type { PortfolioRef } from '../app/types';

interface Props {
  portfolio?: PortfolioRef;
  onClick: () => void;
}

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Shows which portfolio grounds the answers; opens the switcher. */
export function GroundingChip({ portfolio, onClick }: Props) {
  return (
    <button type="button" className="sv-a-c-ground" data-empty={portfolio ? undefined : 'true'} onClick={onClick}>
      <span className="sv-a-c-ground-dot" />
      <span className="sv-a-c-ground-name">{portfolio ? portfolio.name : 'No portfolio'}</span>
      <span className="sv-a-c-ground-chev">{CHEVRON}</span>
    </button>
  );
}
