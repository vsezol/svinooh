import { useState } from 'react';
import type { ChoiceBlock } from '../../app/types';

export const answerOf = (block: ChoiceBlock, option: string): string =>
  `${block.header}: ${option}`;

interface Props {
  block: ChoiceBlock;
  onChoose?: (answer: string) => void;
}

export default function ChoiceBlockView({ block, onChoose }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);

  const choose = (option: string) => {
    if (!onChoose || chosen) return;
    setChosen(option);
    onChoose(answerOf(block, option));
  };

  return (
    <div className="sv-a-b-card sv-a-b-choice" data-answered={chosen ? 'yes' : 'no'}>
      <div className="sv-a-b-eyebrow">{block.header.toUpperCase()}</div>
      <div className="sv-a-b-choice-question">{block.question}</div>
      <div className="sv-a-b-choice-options">
        {block.options.map((option) => (
          <button
            key={option}
            type="button"
            className="ui-btn"
            data-variant={chosen === option ? 'accent' : 'soft'}
            data-size="md"
            disabled={!onChoose || chosen !== null}
            onClick={() => choose(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {!onChoose ? (
        <span className="sv-a-b-choice-note mono">Open the chat on svinooh.com to answer.</span>
      ) : null}
    </div>
  );
}
