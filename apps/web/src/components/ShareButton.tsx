import { useState } from 'react';

const SHARE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3M12 3L8 7M12 3l4 4" />
    <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" />
  </svg>
);

/**
 * One behaviour per device, decided up front rather than by whatever the
 * browser happens to support.
 *
 * On a touch device the system sheet is the point — that is how a link gets
 * into a chat. On a desktop the sheet is a clumsy popup nobody asked for, so
 * the link goes to the clipboard and the button says so. Feature-detecting
 * `navigator.share` alone made this unpredictable: some desktop browsers have
 * it, so the same button did different things on different machines.
 */
function prefersSystemSheet(): boolean {
  return typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    if (prefersSystemSheet()) {
      try {
        await navigator.share({ title, url });
      } catch {
        // dismissed — nothing to report, the user closed the sheet on purpose
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no clipboard access (an insecure context) — leave the label alone
    }
  };

  return (
    <button className="pill-btn" onClick={() => void share()} title="Share this portfolio">
      {SHARE_ICON}
      <span>{copied ? 'COPIED' : 'SHARE'}</span>
    </button>
  );
}
