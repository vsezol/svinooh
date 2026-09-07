import type { TextBlock } from '../../app/types';

export default function TextBlockView({ block }: { block: TextBlock }) {
  return <p className="sv-a-b-text">{block.text}</p>;
}
