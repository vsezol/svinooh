interface Props {
  text: string;
  retryAfterS?: number;
  onRetry?: () => void;
}

/**
 * A centered out-of-band line (expiry, rate limit, outage). The wire carries
 * the bare reason; the countdown suffix is composed here so a ticking caller
 * only swaps the number.
 */
export function SystemNote({ text, retryAfterS, onRetry }: Props) {
  return (
    <div className="sv-a-c-note">
      <span className="sv-a-c-note-text">
        {text}
      </span>
      {onRetry ? (
        <button type="button" className="ui-btn" data-variant="soft" data-size="xs" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
