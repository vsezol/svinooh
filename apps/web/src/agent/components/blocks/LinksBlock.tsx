import type { LinksBlock } from '../../app/types';

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/**
 * Where an answer leads.
 *
 * An assistant that can only talk ends every answer with the reader working
 * out what to do about it. These are that step, already taken: the position it
 * just described, the alert it just suggested. They are the reason the chat can
 * be the way into the rest of the app rather than a window beside it.
 */
export default function LinksBlockView({
  block,
  onFollow,
}: {
  block: LinksBlock;
  onFollow?: (href: string) => void;
}) {
  return (
    <div className="sv-a-b-links">
      {block.links.map((link, i) => (
        <button
          key={i}
          type="button"
          className="sv-a-b-link"
          onClick={() => onFollow?.(link.href)}
        >
          {link.label}
          <Arrow />
        </button>
      ))}
    </div>
  );
}
