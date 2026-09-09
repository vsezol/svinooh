import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useHoldStill } from '../app/useHoldStill';

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

/** How tall the box may grow before it scrolls instead. */
const MAX_HEIGHT = 200;

/**
 * Whether the keyboard in front of this is a touch one.
 *
 * The pointer, not the width: what decides how Enter should behave is whether
 * there is a shift key to hold, and a phone in landscape is still a phone.
 */
function useTouchKeyboard(): boolean {
  const query = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/**
 * The message box, with the conventions people already have from every other
 * chat: the box grows with the text to a ceiling and then scrolls, and Enter
 * does what Enter does on the keyboard in front of you — sends on a hardware
 * one, where Shift+Enter is there for a line break, and opens a line on a
 * touch one, where it is not and the button is right there.
 *
 * A textarea cannot size itself to its content in CSS, so the height is reset
 * to auto and set from scrollHeight on every change — resetting first is what
 * lets it shrink again when text is deleted.
 */
export function Composer({ placeholder, disabled, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const touch = useTouchKeyboard();
  // While this has focus the page stops panning out from under it.
  useHoldStill(focused);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    // Measured on the next frame, not immediately: the stylesheet is injected
    // by the bundle, so on the first mount an effect can run against a box the
    // rules have not reached yet and read a height that was never real.
    const frame = requestAnimationFrame(() => {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
    });
    return () => cancelAnimationFrame(frame);
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift, and the IME's own Enter while a composition is open, both mean
    // "keep typing" — sending mid-composition would cut a word in half for
    // anyone typing Japanese, Chinese or Korean.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    // A touch keyboard has no shift to hold, so Enter is the only way to open
    // a line and the button is the only way to send. Taking Enter here left a
    // phone with no way to write a second line at all.
    if (touch) return;
    event.preventDefault();
    send();
  };

  return (
    <form className="sv-a-c-composer" onSubmit={submit}>
      <textarea
        ref={box}
        className="sv-a-c-composer-input"
        rows={1}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Message"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        // The key does what the label says: a return glyph where it opens a
        // line, "send" where it sends.
        enterKeyHint={touch ? 'enter' : 'send'}
      />
      <button type="submit" className="sv-a-c-composer-send" disabled={disabled || !draft.trim()} aria-label="Send">
        {ARROW}
      </button>
    </form>
  );
}
