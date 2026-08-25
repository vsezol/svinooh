interface Props {
  size?: number;
  onClick?: () => void;
}

/** svin[oo]h logo — the two "o"s as outlined circle eyes */
export function Logo({ size = 21, onClick }: Props) {
  return (
    <div className="logo" style={{ fontSize: size }} onClick={onClick}>
      <span>svin</span>
      <span className="eye eye-1" />
      <span className="eye eye-2" />
      <span className="h">h</span>
    </div>
  );
}
