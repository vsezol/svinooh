import type { PortfolioRef } from '../app/types';
import { OpenerChips } from './OpenerChips';

interface Props {
  portfolio?: PortfolioRef;
  meta?: string;
  chips: string[];
  onPick: (text: string) => void;
}

/** The empty log of a grounded chat: what to ask, about what. */
export function EmptyGrounded({ portfolio, meta, chips, onPick }: Props) {
  // The host may know sync freshness the ref does not carry; its meta wins.
  const derived = portfolio
    ? [
        portfolio.wallets != null ? `${portfolio.wallets} wallets` : null,
        portfolio.totalUsd != null ? '$' + Math.round(portfolio.totalUsd).toLocaleString('en-US') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const line = meta ?? (derived || undefined);

  return (
    <div className="sv-a-c-empty">
      <h2 className="sv-a-c-empty-title">Ask about {portfolio ? portfolio.name : 'your portfolio'}</h2>
      {line ? <div className="sv-a-c-eyebrow">{line}</div> : null}
      <OpenerChips chips={chips} onPick={onPick} />
    </div>
  );
}
