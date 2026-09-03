'use client';

import { useMemo } from 'react';
import { EYEBROW, InfoMark, Notice } from './fields';
import { groupSettings } from './groups';
import { SettingRow } from './SettingRow';
import { useSettings } from './useSettings';

/**
 * Throughput, as a tab in the product rather than a service of its own.
 *
 * This module is loaded lazily and only for an admin — see the import in
 * PortfolioPage — so it is not in the bundle everybody else downloads. That is
 * about weight and tidiness, not secrecy: a chunk is fetchable by anyone who
 * knows its URL, and the knobs it names are declared in a file that is public
 * in the repository anyway. What actually protects the system is that every
 * route behind these controls checks the database, and answers NotFound to
 * anybody who is not an admin.
 *
 * The screen only arranges things: state is in useSettings, a knob is a
 * SettingRow, and the controls are in fields.
 */
export function AdminPanel() {
  const { specs, draft, changed, problems, saved, busy, denied, set, save } = useSettings();
  const groups = useMemo(() => (specs ? groupSettings(specs) : []), [specs]);
  const dirty = Object.keys(changed).length > 0;

  if (denied) {
    return (
      <div
        className="card"
        style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}
      >
        Nothing here.
      </div>
    );
  }

  return (
    <div>
      <div className="mono" style={{ ...EYEBROW, fontSize: 10.5 }}>
        ADMIN
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>Throughput</span>
        <InfoMark>
          How hard the system pushes. A change is live within fifteen seconds, and a knob left at
          its default is not stored at all.
        </InfoMark>
      </div>

      {specs === null ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <span className="spin" style={{ width: 20, height: 20 }} />
        </div>
      ) : (
        <>
          {problems.map((problem) => (
            <Notice key={problem} tone="bad">
              {problem}
            </Notice>
          ))}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
            {groups.map((group) => (
              <div key={group.key} className="card" style={{ padding: '15px 18px 18px' }}>
                <div className="mono" style={EYEBROW}>
                  {group.label.toUpperCase()}
                </div>
                {group.specs.map((spec) => (
                  <SettingRow
                    key={spec.key}
                    spec={spec}
                    value={draft[spec.key] ?? String(spec.value)}
                    onChange={(value) => set(spec.key, value)}
                  />
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button
              className="btn-acc"
              style={{ height: 40, fontSize: 13, padding: '0 20px' }}
              onClick={save}
              disabled={!dirty || busy}
            >
              {busy ? (
                <span
                  className="spin"
                  style={{ width: 14, height: 14, borderTopColor: 'var(--acc-ink)' }}
                />
              ) : (
                'Save'
              )}
            </button>
            {/* One line, where the eye already is after pressing the button */}
            <span className="mono" style={{ fontSize: 11, color: 'var(--mut)' }}>
              {dirty ? `${Object.keys(changed).length} changed` : saved ? 'Saved' : ''}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminPanel;
