import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const KEBAB = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);

const LOCK = (
  <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.3}>
    <rect x="2.2" y="5.2" width="7.6" height="5.3" rx="1.2" />
    <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4" />
  </svg>
);

const WIDTH = 190;
const GAP = 6;

/**
 * Wallet actions behind a kebab.
 *
 * The menu is a portal on <body>, positioned against the button. Inside the
 * wallet card it was clipped by that card's `overflow: hidden` — a collapsed
 * row, or simply a short one, cut the menu in half. Nothing an ancestor does
 * can crop it now, and it flips above the button when there is no room below.
 *
 * The actions sit here rather than beside the expand chevron because one of
 * them deletes a wallet, and that button used to be a few pixels from the one
 * that opens it.
 */
export function WalletMenu({
  locked,
  onRename,
  onRemove,
}: {
  /** The actions need an account — say so rather than failing after the click */
  locked?: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      const height = menu.current?.offsetHeight ?? 0;
      const below = rect.bottom + GAP;
      // Flip above the button when the menu would run off the bottom
      const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - GAP - height) : below;
      const left = Math.min(Math.max(8, rect.right - WIDTH), window.innerWidth - WIDTH - 8);
      setPos({ top, left });
    };
    place();
    // Measuring again once the menu exists gives the flip its real height
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Anchored to a button that scrolls away — close rather than drift
    const away = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        className="row-icon-btn"
        title="Wallet options"
        aria-label="Wallet options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {KEBAB}
      </button>

      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              style={{
                position: 'fixed',
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                width: WIDTH,
                zIndex: 900,
                background: 'var(--surf)',
                border: '1px solid var(--line2)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: '0 20px 50px -20px rgba(0,0,0,0.55)',
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              <button className="menu-item" role="menuitem" onClick={pick(onRename)}>
                {locked ? LOCK : null}
                Rename
              </button>
              <button
                className={locked ? 'menu-item' : 'menu-item danger'}
                role="menuitem"
                onClick={pick(onRemove)}
              >
                {locked ? LOCK : null}
                Remove wallet
              </button>
              {locked ? (
                <div
                  className="mono"
                  style={{
                    padding: '9px 14px 11px',
                    fontSize: 10,
                    color: 'var(--mut)',
                    borderTop: '1px solid var(--line)',
                    lineHeight: 1.6,
                  }}
                >
                  Sign in to take this portfolio over
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
