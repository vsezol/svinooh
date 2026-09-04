import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { portfolioLabel } from '../lib/format';

/**
 * What this portfolio is called, at the top of the page — and, for the owner,
 * the place to change it. Same inline-edit contract as a wallet's label: click
 * the pencil, type, Enter or blur commits, Escape walks away. The difference a
 * reader should know about is spelled out under the input: the name becomes
 * the link, so renaming moves the page.
 */
export function PortfolioName({
  name,
  slug,
  editable,
  onRename,
}: {
  name: string | null;
  slug: string;
  editable: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const label = portfolioLabel(name, slug);
  // No name yet — the label IS the slug, and a slug reads as an identifier
  const bare = !name?.trim();

  const startEdit = () => {
    setValue(name ?? '');
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const v = value.trim();
    if (v !== (name ?? '')) onRename(v);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ marginBottom: 10 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          autoFocus
          spellCheck={false}
          maxLength={64}
          placeholder="Name this portfolio"
          aria-label="Portfolio name"
          style={{
            fontFamily: 'var(--sans)',
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--fs-lead)',
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--acc)',
            outline: 'none',
            padding: '0 0 2px',
            width: 'min(260px, 100%)',
          }}
        />
        <div className="mono" style={{ marginTop: 5, fontSize: 'var(--fs-micro)', letterSpacing: '0.04em', color: 'var(--mut)' }}>
          The name becomes the link — /p/{'{'}your-name{'}'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, minWidth: 0 }}>
      <span
        className={bare ? 'mono' : undefined}
        style={{
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--fs-lead)',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {editable ? (
        <button
          onClick={startEdit}
          aria-label="Rename portfolio"
          title="Rename portfolio"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--mut)',
            cursor: 'pointer',
            padding: 2,
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
