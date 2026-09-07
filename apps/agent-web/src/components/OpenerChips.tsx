interface Props {
  chips: string[];
  onPick: (text: string) => void;
}

/** Suggested first questions; picking one sends it as if typed. */
export function OpenerChips({ chips, onPick }: Props) {
  return (
    <div className="sv-a-c-chips">
      {chips.map((chip) => (
        <button key={chip} type="button" className="sv-a-c-chip" onClick={() => onPick(chip)}>
          {chip}
        </button>
      ))}
    </div>
  );
}
