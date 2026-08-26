import { useEffect, useRef, useState } from 'react';
import { fmtUsd } from '../lib/format';

export interface ScopeOption {
  id: string;
  label: string;
  valueUsd: number | null;
}

/**
 * Which wallet the headline and the chart are showing. A chip per wallet used
 * up two or three rows above the chart on a real portfolio; a dropdown says the
 * same thing in one line and has room to show each wallet's value next to it.
 */
export function ScopeSelect({
  options,
  value,
  onChange,
}: {
  options: ScopeOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <div ref={box} style={{ position: 'relative', minWidth: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid var(--line2)',
          background: 'transparent',
          color: 'var(--text)',
          borderRadius: 999,
          height: 34,
          padding: '0 14px',
          cursor: 'pointer',
          maxWidth: '100%',
          fontFamily: 'var(--sans)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current?.label ?? 'ALL WALLETS'}
        </span>
        <span
          style={{
            width: 7,
            height: 7,
            borderRight: '1.5px solid var(--mut)',
            borderBottom: '1.5px solid var(--mut)',
            transform: 'rotate(45deg) translate(-1px,-1px)',
            flexShrink: 0,
          }}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 90,
            minWidth: 250,
            background: 'var(--surf)',
            border: '1px solid var(--line2)',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 20px 50px -20px rgba(0,0,0,0.55)',
          }}
        >
          {options.map((o) => (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className="menu-item"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              style={{ justifyContent: 'space-between', gap: 14, color: o.id === value ? 'var(--acc-text)' : 'var(--text)' }}
            >
              <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {o.label}
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--mut)', whiteSpace: 'nowrap' }}>
                {o.valueUsd === null ? '—' : fmtUsd(o.valueUsd, 0)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
