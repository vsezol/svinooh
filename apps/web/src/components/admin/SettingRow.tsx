'use client';

import type { SettingDto } from '@svinooh/shared';
import type { ModelChoiceDto } from '@svinooh/shared';
import { ChoiceField, InfoMark, SettingModel, SettingNumber, SettingText } from './fields';

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
  /** What the models on offer can do — empty when the catalogue is unreachable */
  models: ModelChoiceDto[];
  /** What this role's thinking knob is set to right now, for a knob that names a model */
  effort?: string;
  onChange: (value: string) => void;
}

/**
 * One knob: its name, its unit, and the control that changes it.
 *
 * Everything a person needs only when they stop on this particular knob is
 * behind the mark — a wall of explanation beside thirteen inputs is a wall
 * nobody reads.
 */
export function SettingRow({ spec, value, models, effort, onChange }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-row-name">
        <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)' }}>{spec.label}</span>
        {spec.unit ? (
          <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
            {spec.unit}
          </span>
        ) : null}
        <InfoMark>
          {spec.about}
          {spec.note ? <div style={{ marginTop: 6 }}>{spec.note}</div> : null}
          {spec.live ? null : (
            <div style={{ marginTop: 6, color: 'var(--down)' }}>Takes effect on the next deploy.</div>
          )}
        </InfoMark>
      </div>

      {/* One wrapper whatever the control turns out to be, so a phone has a
          single thing to give the width to — the number case is two siblings,
          a readable hint beside the field. */}
      <div className="setting-row-control">
        {spec.kind === 'choice' ? (
          <ChoiceField value={value} options={spec.options ?? []} label={spec.label} onChange={onChange} />
        ) : spec.kind === 'text' && spec.role ? (
          <SettingModel
            value={value}
            models={models}
            thinking={{ effort: effort ?? '', noThinking: spec.role.noThinking }}
            maxLength={spec.maxLength}
            placeholder={spec.placeholder}
            label={spec.label}
            onChange={onChange}
          />
        ) : spec.kind === 'text' ? (
          <SettingText
            value={value}
            maxLength={spec.maxLength}
            placeholder={spec.placeholder}
            label={spec.label}
            onChange={onChange}
          />
        ) : (
          <>
            <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
              {plainer(value, spec.unit)}
            </span>
            <SettingNumber value={value} min={spec.min} max={spec.max} label={spec.label} onChange={onChange} />
          </>
        )}
      </div>
    </div>
  );
}
