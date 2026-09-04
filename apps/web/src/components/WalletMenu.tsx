import { useRef, useState } from 'react';
import { AnchoredMenu, IconButton, MenuItem } from '../ui';

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

/**
 * Wallet actions behind a kebab.
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
  const [open, setOpen] = useState(false);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <IconButton
        ref={button}
        variant="bare"
        size="xs"
        label="Wallet options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {KEBAB}
      </IconButton>

      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchor={button}
        width={WIDTH}
        label="Wallet options"
      >
        <MenuItem role="menuitem" onClick={pick(onRename)}>
          {locked ? LOCK : null}
          Rename
        </MenuItem>
        <MenuItem role="menuitem" tone={locked ? undefined : 'danger'} onClick={pick(onRemove)}>
          {locked ? LOCK : null}
          Remove wallet
        </MenuItem>
        {locked ? (
          <div
            className="mono"
            style={{
              padding: '9px 14px 11px',
              fontSize: 'var(--fs-micro)',
              color: 'var(--mut)',
              borderTop: '1px solid var(--line)',
              lineHeight: 1.6,
            }}
          >
            Sign in to take this portfolio over
          </div>
        ) : null}
      </AnchoredMenu>
    </div>
  );
}
