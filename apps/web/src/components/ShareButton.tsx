import { useState } from 'react';

const SHARE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3M12 3L8 7M12 3l4 4" />
    <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" />
  </svg>
);

/**
 * The system share sheet where there is one — phones, mostly, which is where
 * sharing a portfolio actually happens — and a copy-to-clipboard fallback
 * everywhere else. "COPY LINK" was neither: on a phone it bypassed the sheet
 * people expect, and on a desktop it said what it did rather than why.
 */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // dismissed, or the sheet refused — fall through to copying
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no clipboard access (insecure context) — nothing useful left to do
    }
  };

  return (
    <button className="pill-btn" onClick={() => void share()} title="Share this portfolio">
      {SHARE_ICON}
      <span>{copied ? 'COPIED' : 'SHARE'}</span>
    </button>
  );
}
