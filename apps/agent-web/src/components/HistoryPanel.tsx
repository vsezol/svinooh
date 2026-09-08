import { useRef } from 'react';
import type { Conversation } from '../app/types';
import { Sheet, useDismiss } from './Sheet';

interface Props {
  conversations: Conversation[];
  currentId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose?: () => void;
  mode: 'rail' | 'popover' | 'sheet';
}

const PLUS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/**
 * "Just now" / "Nh ago" / "Yesterday" / "N days ago" / "Mon D". Calendar-day
 * arithmetic, not 24h buckets: a chat from last evening reads "Yesterday"
 * even when it is only 10 hours old.
 */
function relativeDate(at: number, now: number = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  const startOfDay = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) {
    if (mins < 60) return 'Just now';
    return `${Math.floor(mins / 60)}h ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Past conversations: a static rail on desktop, popover or sheet elsewhere. */
export function HistoryPanel({ conversations, currentId, onSelect, onNew, onClose, mode }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(mode === 'popover', onClose, ref);

  const newChat = (block: boolean) => (
    <button
      type="button"
      className="ui-btn"
      data-variant="soft"
      data-size="sm"
      data-block={block ? 'true' : undefined}
      onClick={onNew}
    >
      {PLUS}
      New chat
    </button>
  );

  const list = (
    <div className="sv-a-c-hist-list">
      {conversations.map((c) => (
        <button
          key={c.id}
          type="button"
          className="sv-a-c-hist-item"
          data-active={c.id === currentId ? 'true' : undefined}
          onClick={() => onSelect(c.id)}
        >
          <span className="sv-a-c-hist-title">{c.title}</span>
          <span className="sv-a-c-hist-date">{relativeDate(c.at)}</span>
        </button>
      ))}
    </div>
  );

  if (mode === 'rail') {
    // The kit's rail furniture, the same classes the site's own sidebar uses.
    // Two rails drawing one design is how they drifted apart the first time.
    return (
      <aside className="sv-a-c-hist" data-mode="rail">
        <button type="button" className="rail-new" onClick={onNew}>
          {PLUS}
          New chat
        </button>
        <div className="rail-eyebrow mono">HISTORY</div>
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            className="rail-history"
            data-active={c.id === currentId ? 'true' : undefined}
            onClick={() => onSelect(c.id)}
          >
            <span className="rail-history-title">{c.title}</span>
            <span className="rail-history-when mono">{relativeDate(c.at)}</span>
          </button>
        ))}
      </aside>
    );
  }

  const body = (
    <div className="sv-a-c-hist" data-mode={mode}>
      <div className="sv-a-c-hist-head">
        <span className="sv-a-c-eyebrow">History</span>
        {newChat(false)}
      </div>
      {list}
    </div>
  );

  if (mode === 'sheet') {
    return (
      <Sheet open onClose={onClose ?? (() => undefined)}>
        {body}
      </Sheet>
    );
  }
  return (
    <div ref={ref} className="sv-a-c-pop" data-align="right">
      {body}
    </div>
  );
}
