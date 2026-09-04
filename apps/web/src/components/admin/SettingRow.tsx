'use client';

import type { SettingDto } from '@svinooh/shared';
import { ChoiceField, InfoMark, SettingNumber } from './fields';

/**
 * The same number said the way a person would say it, or null when the raw
 * figure is already the readable one.
 *
 * The registry keeps minutes and milliseconds because that is what the services
 * read, and 1440 is not a number anybody parses as a day at a glance. Only
 * whole multiples get a hint: "1.5 s" helps, "0.4166 h" does not.
 */
function plainer(raw: string, unit?: string): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'min') {
    if (n % 1440 === 0) return `${n / 1440} d`;
    if (n % 60 === 0) return `${n / 60} h`;
    return null;
  }
  if (unit === 'ms' && n >= 1000) {
    const seconds = n / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  }
  return null;
}

export interface SettingRowProps {
  spec: SettingDto;
  value: string;
  onChange: (value: string) => void;
}

/**
 * One knob: its name, its unit, and the control that changes it.
 *
 * Everything a person needs only when they stop on this particular knob is
 * behind the mark — a wall of explanation beside thirteen inputs is a wall
 * nobody reads.
 */
export function SettingRow({ spec, value, onChange }: SettingRowProps) {
  return (
    // position:relative so the tooltip can anchor to the row — see InfoMark
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, position: 'relative' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)' }}>{spec.label}</span>
        {spec.unit ? (
          <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
            {spec.unit}
          </span>
        ) : null}
        <InfoMark inRow>
          {spec.about}
          {spec.note ? <div style={{ marginTop: 6 }}>{spec.note}</div> : null}
          {spec.live ? null : (
            <div style={{ marginTop: 6, color: 'var(--down)' }}>Takes effect on the next deploy.</div>
          )}
        </InfoMark>
      </div>

      {spec.kind === 'choice' ? (
        <ChoiceField value={value} options={spec.options ?? []} label={spec.label} onChange={onChange} />
      ) : (
        <>
          <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
            {plainer(value, spec.unit)}
          </span>
          <SettingNumber value={value} min={spec.min} max={spec.max} label={spec.label} onChange={onChange} />
        </>
      )}
    </div>
  );
}
