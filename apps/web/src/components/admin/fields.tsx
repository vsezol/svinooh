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

export interface SettingTextProps {
  value: string;
  maxLength?: number;
  placeholder?: string;
  label: string;
  onChange: (value: string) => void;
}

/**
 * Wide, and mono, because what goes in it is an identifier rather than prose —
 * "openai:qwen/qwen3-30b-a3b-instruct-2507" is read character by character
 * when something is wrong with it.
 */
export function SettingText({ value, maxLength, placeholder, label, onChange }: SettingTextProps) {
  return (
    <Input
      mono
      size="md"
      shape="box"
      aria-label={label}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 300 }}
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
    <Select
      label={label}
      value={value}
      options={options.map((option) => ({ value: option, label: option }))}
      onChange={onChange}
      align="right"
      width={124}
    />
  );
}

export interface InfoMarkProps {
  children: ReactNode;
}

/** The site's own info mark: hover on a desktop, focus from a keyboard */
export function InfoMark({ children }: InfoMarkProps) {
  return <InfoTip text={children} />;
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
