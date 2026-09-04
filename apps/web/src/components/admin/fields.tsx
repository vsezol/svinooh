'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Card, Input, InfoTip, Select } from '../../ui';

/**
 * What the panel's rows are made of.
 *
 * The shapes are the kit's; what is here is the two or three things that are
 * true only of a settings knob — the width a number gets, and that it steps
 * with the keyboard between a minimum and a maximum.
 */

export interface SettingNumberProps {
  value: string;
  min?: number;
  max?: number;
  label: string;
  onChange: (value: string) => void;
}

/**
 * Committed as it is typed rather than on blur, unlike the kit's NumberField:
 * nothing here is saved until Save is pressed, so the draft IS the state and
 * there is nothing for a commit step to protect.
 */
export function SettingNumber({ value, min, max, label, onChange }: SettingNumberProps) {
  return (
    <Input
      mono
      size="md"
      shape="box"
      type="number"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 92 }}
    />
  );
}

export interface ChoiceFieldProps {
  value: string;
  options: string[];
  label: string;
  onChange: (value: string) => void;
}

export function ChoiceField({ value, options, label, onChange }: ChoiceFieldProps) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 124 }}>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  );
}

export interface InfoMarkProps {
  children: ReactNode;
  /**
   * Anchor the popover to the enclosing row rather than to the mark itself, so
   * it spans the card instead of running off the side of a phone. The row has
   * to be position:relative for this.
   */
  inRow?: boolean;
}

/** The site's own info mark: hover on a desktop, focus from a keyboard */
export function InfoMark({ children, inRow = false }: InfoMarkProps) {
  return <InfoTip text={children} anchor={inRow ? 'row' : undefined} />;
}

export interface NoticeProps {
  tone: 'bad' | 'plain';
  children: ReactNode;
}

export function Notice({ tone, children }: NoticeProps) {
  return (
    <Card
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderLeft: `2px solid ${tone === 'bad' ? 'var(--down)' : 'var(--line2)'}`,
        fontSize: 'var(--fs-body)',
        color: 'var(--text)',
        lineHeight: 1.5,
      }}
    >
      {children}
    </Card>
  );
}

export const EYEBROW: CSSProperties = {
  fontSize: 'var(--fs-micro)',
  letterSpacing: '0.16em',
  color: 'var(--mut)',
};
