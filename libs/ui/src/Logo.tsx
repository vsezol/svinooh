interface Props {
  /**
   * In pixels. `null` leaves it to the stylesheet, which is what a mark that
   * changes size with the viewport needs — an inline font-size cannot be
   * overridden by a media query.
   */
  size?: number | null;
  onClick?: () => void;
  /**
   * Just the eyes, without the word.
   *
   * What a collapsing header keeps when it gives up the rest: the mark is the
   * half of the wordmark that is still recognisable at a glance and in 20
   * pixels, which is all a header has left once it has folded down to a strip.
   */
  mark?: boolean;
}

/** svin[oo]h logo — the two "o"s as outlined circle eyes */
export function Logo({ size = 21, onClick, mark = false }: Props) {
  return (
    <div
      className={mark ? 'logo logo-mark' : 'logo'}
      style={size === null ? undefined : { fontSize: size }}
      onClick={onClick}
    >
      {mark ? null : <span>svin</span>}
      <span className="eye eye-1" />
      <span className="eye eye-2" />
      {mark ? null : <span className="h">h</span>}
    </div>
  );
}
