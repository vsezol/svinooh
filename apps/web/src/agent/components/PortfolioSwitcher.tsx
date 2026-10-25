import { useRef } from 'react';
import type { PortfolioRef } from '../app/types';
import { Sheet, useDismiss } from './Sheet';

interface Props {
  open: boolean;
  portfolios: PortfolioRef[];
  currentSlug?: string;
  onSelect: (slug: string) => void;
  onClose: () => void;
  mode: 'sheet' | 'popover';
}

/**
 * Handed to onSelect by the "New portfolio" row. Real slugs are server-issued
 * portfolio ids; the caller treats this word as the create-flow signal.
 */
export const NEW_PORTFOLIO = 'new';

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />
  </svg>
);

const PLUS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

function subLine(p: PortfolioRef): string {
  const parts: string[] = [];
  if (p.totalUsd != null) parts.push('$' + Math.round(p.totalUsd).toLocaleString('en-US'));
  if (p.wallets != null) parts.push(`${p.wallets} wallet${p.wallets === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Picks which portfolio grounds the chat; sheet on mobile, popover on desktop. */
export function PortfolioSwitcher({ open, portfolios, currentSlug, onSelect, onClose, mode }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open && mode === 'popover', onClose, ref);

  if (!open) return null;

  const body = (
    <div className="sv-a-c-switch">
      <div className="sv-a-c-eyebrow">Grounded in</div>
      {portfolios.map((p) => {
        const current = p.slug === currentSlug;
        const sub = subLine(p);
        return (
          <button
            key={p.slug}
            type="button"
            className="sv-a-c-switch-row"
            data-current={current ? 'true' : undefined}
            onClick={() => onSelect(p.slug)}
          >
            <span className="sv-a-c-switch-text">
              <span className="sv-a-c-switch-name">{p.name}</span>
              {sub ? <span className="sv-a-c-switch-sub">{sub}</span> : null}
            </span>
            {current ? <span className="sv-a-c-switch-check">{CHECK}</span> : null}
          </button>
        );
      })}
      <button type="button" className="sv-a-c-switch-row" data-new="true" onClick={() => onSelect(NEW_PORTFOLIO)}>
        <span className="sv-a-c-switch-plus">{PLUS}</span>
        <span className="sv-a-c-switch-name">New portfolio</span>
      </button>
    </div>
  );

  if (mode === 'sheet') {
    return (
      <Sheet open onClose={onClose}>
        {body}
      </Sheet>
    );
  }
  return (
    <div ref={ref} className="sv-a-c-pop">
      {body}
    </div>
  );
}
