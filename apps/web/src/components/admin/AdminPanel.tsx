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
 * A row is a name and a control. Everything a person needs only when they stop
 * on a particular knob — what it costs, what it is measured against, why it
 * sits where it does — is behind the mark beside the name, because a wall of
 * explanation next to thirteen inputs is a wall nobody reads.
 */

const FIELD: CSSProperties = {
  width: 92,
  height: 34,
  textAlign: 'right',
  background: 'var(--surf2)',
  border: '1px solid var(--line2)',
  borderRadius: 10,
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
};

const SELECT: CSSProperties = { ...FIELD, width: 124, textAlign: 'left', cursor: 'pointer' };

const EYEBROW: CSSProperties = { fontSize: 10, letterSpacing: '0.16em', color: 'var(--mut)' };

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

/**
 * The site's own info mark: a hover, and focusable so a keyboard can reach it.
 * `.infotip` and its popover are in styles.css, next to the one the profit
 * figure uses.
 */
function Info({ children, row = false }: { children: React.ReactNode; row?: boolean }) {
  return (
    <span className={row ? 'infotip infotip-row' : 'infotip'} tabIndex={0} role="note">
      i<span className="infotip-pop">{children}</span>
    </span>
  );
}

function Row({
  spec,
  value,
  onChange,
}: {
  spec: SettingDto;
  value: number | string;
  onChange: (v: string) => void;
}) {
  return (
    // The row is the popover's anchor, so it spans the card instead of running
    // off the side of a phone — see .infotip-row
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{spec.label}</span>
        {spec.unit ? (
          <span className="mono" style={{ fontSize: 11, color: 'var(--mut)' }}>
            {spec.unit}
          </span>
        ) : null}
        <Info row>
          {spec.about}
          {spec.live ? null : (
            <div style={{ marginTop: 6, color: 'var(--down)' }}>Takes effect on the next deploy.</div>
          )}
        </Info>
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
      <div className="mono" style={{ ...EYEBROW, fontSize: 10.5 }}>
        ADMIN
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>Throughput</span>
        <Info>
          How hard the system pushes. A change is live within fifteen seconds, and a knob left at
          its default is not stored at all.
        </Info>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
            {groups.map((group) => (
              <div key={group.key} className="card" style={{ padding: '15px 18px 18px' }}>
                <div className="mono" style={EYEBROW}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button
              className="btn-acc"
              style={{ height: 40, fontSize: 13, padding: '0 20px' }}
              onClick={() => void save()}
              disabled={!dirty || busy}
            >
              {busy ? <span className="spin" style={{ width: 14, height: 14, borderTopColor: 'var(--acc-ink)' }} /> : 'Save'}
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
