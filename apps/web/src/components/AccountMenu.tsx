'use client';

import { useRef, useState } from 'react';
import { AnchoredMenu, MenuItem } from '../ui';

/**
 * Who you are, and the two things you can do about it.
 *
 * The header used to carry all of it in a row: the handle, a PRO tag, and an
 * EXIT button. On a phone that row ran off the right edge — the wordmark, a
 * portfolio switcher, a tag, a toggle, an avatar, a name and a button, in
 * 375px — and EXIT, being last, was the half that fell off.
 *
 * None of those three is something you reach for often, and all three are
 * about the account, which is what the avatar already means. So the avatar
 * opens them.
 */

interface Props {
  name: string;
  username?: string | null;
  photoUrl?: string | null;
  onPro: () => void;
  onExit: () => void;
}

export function AccountMenu({ name, username, photoUrl, onPro, onExit }: Props) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const handle = username ? `@${username}` : name;

  return (
    <>
      {/* ph-mask / ph-no-capture: who this is never reaches session replay */}
      <button
        ref={anchor}
        type="button"
        className="account-mark ph-mask"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" className="ph-no-capture" />
        ) : (
          <span className="mono">{(name || '?').slice(0, 2).toUpperCase()}</span>
        )}
      </button>

      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchor={anchor} width={216} label="Account">
        {/* The handle is a heading, not an action — it says whose menu this is */}
        <div className="account-menu-who mono ph-mask">{handle}</div>
        <MenuItem
          onClick={() => {
            setOpen(false);
            onPro();
          }}
        >
          Pro
        </MenuItem>
        <MenuItem
          onClick={() => {
            setOpen(false);
            onExit();
          }}
        >
          Sign out
        </MenuItem>
      </AnchoredMenu>
    </>
  );
}
