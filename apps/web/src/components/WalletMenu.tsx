import { useEffect, useRef, useState } from 'react';

const KEBAB = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);

/**
 * Wallet actions behind a kebab. They used to be a bare × sitting a few pixels
 * from the expand chevron, so the button that deletes a wallet and the one that
 * opens it were neighbours — one slip apart. Destructive actions belong behind a
 * deliberate second step.
 */
export function WalletMenu({ onRename, onRemove }: { onRename: () => void; onRemove: () => void }) {
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

  return (
    <div ref={box} style={{ position: 'relative', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <button
        className="row-icon-btn"
        title="Wallet options"
        aria-label="Wallet options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {KEBAB}
      </button>
      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 90,
            minWidth: 170,
            background: 'var(--surf)',
            border: '1px solid var(--line2)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 20px 50px -20px rgba(0,0,0,0.55)',
          }}
        >
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            Rename
          </button>
          <button
            className="menu-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove wallet
          </button>
        </div>
      ) : null}
    </div>
  );
}
