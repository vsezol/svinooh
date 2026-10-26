interface Props {
  chips: string[];
  onPick: (text: string) => void;
}

/** Suggested first questions; picking one sends it as if typed. */
export function OpenerChips({ chips, onPick }: Props) {
  return (
    // The row scrolls sideways, and sideways is also how the page turns: the
    // host reads a horizontal drag on the pane as a swipe between tabs. This
    // says the gesture is ours — see usePager, which looks for it.
    <div className="sv-a-c-chips" data-no-swipe="">
      {chips.map((chip) => (
        <button key={chip} type="button" className="sv-a-c-chip" onClick={() => onPick(chip)}>
          {chip}
        </button>
      ))}
    </div>
  );
}
