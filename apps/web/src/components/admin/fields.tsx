'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * The controls this panel is built from.
 *
 * The project has no shared UI kit — every component carries its own inline
 * styles, the same way AlertSettings and WalletRow do — so these are the
 * panel's own primitives rather than an import from somewhere that does not
 * exist. Keeping them here means a field looks the same in every row without
 * the styles being repeated in each one.
 */

const CONTROL: CSSProperties = {
  height: 34,
  background: 'var(--surf2)',
  border: '1px solid var(--line2)',
  borderRadius: 10,
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
};

export interface NumberFieldProps {
  value: string;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}

export function NumberField({ value, min, max, onChange }: NumberFieldProps) {
  return (
    <input
      className="mono"
      style={{ ...CONTROL, width: 92, textAlign: 'right' }}
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface ChoiceFieldProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

export function ChoiceField({ value, options, onChange }: ChoiceFieldProps) {
  return (
    <select
      style={{ ...CONTROL, width: 124, cursor: 'pointer' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export interface InfoMarkProps {
  children: ReactNode;
  /**
   * Anchor the popover to the enclosing row rather than to the mark itself, so
   * it spans the card instead of running off the side of a phone. The row has
   * to be position:relative for this. See `.infotip-row` in styles.css.
   */
  inRow?: boolean;
}

/** The site's own info mark: hover on a desktop, tap on a phone */
export function InfoMark({ children, inRow = false }: InfoMarkProps) {
  return (
    <span className={inRow ? 'infotip infotip-row' : 'infotip'} tabIndex={0} role="note">
      i<span className="infotip-pop">{children}</span>
    </span>
  );
}

export interface NoticeProps {
  tone: 'bad' | 'plain';
  children: ReactNode;
}

export function Notice({ tone, children }: NoticeProps) {
  return (
    <div
      className="card"
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderLeft: `2px solid ${tone === 'bad' ? 'var(--down)' : 'var(--line2)'}`,
        fontSize: 13,
        color: 'var(--text)',
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export const EYEBROW: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  color: 'var(--mut)',
};
