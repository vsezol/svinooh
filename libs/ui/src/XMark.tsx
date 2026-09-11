/**
 * X's mark, once.
 *
 * A social logo is somebody else's shape, and it was being redrawn: the
 * sign-in dialog carried a simplified path and the chat's sign-in card the
 * official one, so the same account was two slightly different glyphs
 * depending on which surface you were asked from. It travels with the kit for
 * the reason ChainBadge does — a mark everything may need to draw, drawn one
 * way.
 *
 * Takes the current colour, so the caller decides whether it is muted in a
 * footer or inked on an accent button.
 */
export function XMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}
