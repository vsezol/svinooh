/** A transient tool-progress line; successive statuses replace each other. */
export function StatusLine({ text }: { text: string }) {
  return <div className="sv-a-c-status">{text}</div>;
}
