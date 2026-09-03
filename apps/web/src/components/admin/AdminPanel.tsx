'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { SettingDto, SettingsDto, UpdateSettingsDto } from '@svinooh/shared';
import { api, ApiError } from '../../lib/api';

/**
 * Throughput, as a tab in the product rather than a service of its own.
 *
 * This file is loaded lazily and only for an admin — see the import in
 * PortfolioPage — so it is not in the bundle everybody else downloads. That is
 * about weight and tidiness, not secrecy: a chunk is fetchable by anyone who
 * knows its URL, and the knobs it names are declared in a file that is public
 * in the repository anyway. The thing that actually protects the system is that
 * every route behind these controls checks the database, and answers NotFound
 * to anybody who is not an admin.
 *
 * Three knobs decide the pacing and the rest is machinery, so the pacing is the
 * page and the machinery is behind a fold. Same shape the alert settings use:
 * a title, a line of explanation, and a card per group.
 */

const FIELD: CSSProperties = {
  width: 104,
  height: 36,
  textAlign: 'right',
  background: 'var(--surf2)',
  border: '1px solid var(--line2)',
  borderRadius: 10,
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
};

const SELECT: CSSProperties = { ...FIELD, width: 132, textAlign: 'left', cursor: 'pointer' };

/**
 * The groups worth naming, in the order they are worth reading. Anything the
 * registry declares outside these is machinery — real, occasionally necessary,
 * and not what anybody opens this tab for — so it goes in one card at the end
 * rather than earning a heading of its own.
 */
const GROUPS: Array<{ key: string; label: string }> = [
  { key: 'source', label: 'Where balances come from' },
  { key: 'sync', label: 'How often wallets are read' },
];

function Row({ spec, value, onChange }: { spec: SettingDto; value: number | string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>
          {spec.label}
          {spec.unit ? <span style={{ color: 'var(--mut)', fontWeight: 500 }}> · {spec.unit}</span> : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 3, lineHeight: 1.5 }}>{spec.about}</div>
        {spec.live ? null : (
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--down)', marginTop: 4 }}>
            NEEDS A REDEPLOY
          </div>
        )}
      </div>
      {spec.type === 'enum' ? (
        <select style={SELECT} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(spec.options ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="mono"
          style={FIELD}
          type="number"
          value={String(value)}
          min={spec.min ?? undefined}
          max={spec.max ?? undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function AdminPanel() {
  const [specs, setSpecs] = useState<SettingDto[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = (data: SettingsDto) => {
    setSpecs(data.settings);
    setDraft(Object.fromEntries(data.settings.map((s) => [s.key, String(s.value)])));
  };

  useEffect(() => {
    void api<SettingsDto>('/admin/settings')
      .then(load)
      .catch((err) => setDenied(err instanceof ApiError && err.statusCode === 404));
  }, []);

  const groups = useMemo(() => {
    if (!specs) return [];
    const named = new Set(GROUPS.map((g) => g.key));
    return [
      ...GROUPS.map((g) => ({ ...g, specs: specs.filter((s) => s.group === g.key) })),
      { key: 'rest', label: 'Machinery', specs: specs.filter((s) => !named.has(s.group)) },
    ].filter((g) => g.specs.length > 0);
  }, [specs]);

  /**
   * Only what was actually touched. The server treats the payload as a patch,
   * and sending everything would make a rule complain about a number nobody
   * changed the moment a default moves.
   */
  const changed = useMemo(() => {
    if (!specs) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const spec of specs) {
      if (draft[spec.key] !== undefined && draft[spec.key] !== String(spec.value)) {
        out[spec.key] = draft[spec.key];
      }
    }
    return out;
  }, [specs, draft]);

  const dirty = Object.keys(changed).length > 0;

  const save = async () => {
    setBusy(true);
    setProblems([]);
    setSaved(false);
    try {
      const body: UpdateSettingsDto = { values: changed };
      load(await api<SettingsDto>('/admin/settings', { method: 'PUT', body: JSON.stringify(body) }));
      setSaved(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save';
      setProblems(message.split(', '));
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
        Nothing here.
      </div>
    );
  }

  return (
    <div>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--mut)' }}>
        ADMIN
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', marginTop: 6 }}>Throughput</div>
      <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 6, lineHeight: 1.6, maxWidth: 480 }}>
        How hard the system pushes. A change reaches the running services within fifteen seconds — no
        redeploy — and a knob left at its default is not stored at all, so this is a list of decisions
        rather than a copy of the defaults.
      </div>

      {specs === null ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <span className="spin" style={{ width: 20, height: 20 }} />
        </div>
      ) : (
        <>
          {problems.map((problem) => (
            <div
              key={problem}
              className="card"
              style={{
                marginTop: 14,
                padding: '12px 14px',
                borderLeft: '2px solid var(--down)',
                fontSize: 13,
                color: 'var(--text)',
                lineHeight: 1.5,
              }}
            >
              {problem}
            </div>
          ))}
          {saved && !dirty ? (
            <div
              className="card"
              style={{
                marginTop: 14,
                padding: '12px 14px',
                borderLeft: '2px solid var(--acc)',
                fontSize: 13,
                color: 'var(--mut)',
              }}
            >
              Saved. Live within fifteen seconds.
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            {groups.map((group) => (
              <div key={group.key} className="card" style={{ padding: '16px 18px 20px' }}>
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--mut)' }}>
                  {group.label.toUpperCase()}
                </div>
                {group.specs.map((spec) => (
                  <Row
                    key={spec.key}
                    spec={spec}
                    value={draft[spec.key] ?? spec.value}
                    onChange={(v) => setDraft((d) => ({ ...d, [spec.key]: v }))}
                  />
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
            <button
              className="btn-acc"
              style={{ height: 40, fontSize: 13, padding: '0 20px' }}
              onClick={() => void save()}
              disabled={!dirty || busy}
            >
              {busy ? <span className="spin" style={{ width: 14, height: 14, borderTopColor: 'var(--acc-ink)' }} /> : 'Save'}
            </button>
            {dirty ? (
              <span className="mono" style={{ fontSize: 11, color: 'var(--mut)' }}>
                {Object.keys(changed).length} changed
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default AdminPanel;
