import { useState } from 'react';
import type { FormEvent } from 'react';

interface Props {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => void;
}

const ARROW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
);

/**
 * A real form around a single text input: Enter submits through the browser's
 * implicit submission, so there is no key handler to keep in sync with the
 * button.
 */
export function Composer({ placeholder, disabled, onSend }: Props) {
  const [draft, setDraft] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
  };

  return (
    <form className="sv-a-c-composer" onSubmit={submit}>
      <input
        className="sv-a-c-composer-input"
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Message"
        autoComplete="off"
        enterKeyHint="send"
      />
      <button type="submit" className="sv-a-c-composer-send" disabled={disabled || !draft.trim()} aria-label="Send">
        {ARROW}
      </button>
    </form>
  );
}
