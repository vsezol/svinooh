interface Props {
  size?: number;
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
    <div className={mark ? 'logo logo-mark' : 'logo'} style={{ fontSize: size }} onClick={onClick}>
      {mark ? null : <span>svin</span>}
      <span className="eye eye-1" />
      <span className="eye eye-2" />
      {mark ? null : <span className="h">h</span>}
    </div>
  );
}
