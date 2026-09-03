'use client';

import type { SettingDto } from '@svinooh/shared';
import { ChoiceField, InfoMark, NumberField } from './fields';

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
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{spec.label}</span>
        {spec.unit ? (
          <span className="mono" style={{ fontSize: 11, color: 'var(--mut)' }}>
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
        <ChoiceField value={value} options={spec.options ?? []} onChange={onChange} />
      ) : (
        <NumberField value={value} min={spec.min} max={spec.max} onChange={onChange} />
      )}
    </div>
  );
}
