import { useCallback, useRef, useState } from 'react';
import { MenuItem, Panel, useDismiss } from '../ui';
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
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onClose: close, refs: [box] });

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
          borderRadius: 'var(--r-full)',
          height: 'var(--h-sm)',
          padding: '0 14px',
          cursor: 'pointer',
          maxWidth: '100%',
          fontFamily: 'var(--sans)',
        }}
      >
        <span
          style={{
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--fs-note)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
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
        <Panel
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--sp-3))',
            left: 0,
            zIndex: 90,
            minWidth: 250,
          }}
        >
          {options.map((o) => (
            <MenuItem
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              selected={o.id === value}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              style={{ justifyContent: 'space-between', gap: 14 }}
            >
              <span
                style={{
                  fontWeight: 'var(--fw-bold)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {o.label}
              </span>
              <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', whiteSpace: 'nowrap' }}>
                {o.valueUsd === null ? '—' : fmtUsd(o.valueUsd, 0)}
              </span>
            </MenuItem>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
