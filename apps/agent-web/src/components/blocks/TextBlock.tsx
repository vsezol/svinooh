import type { TextBlock } from '../../app/types';
import { Markdown } from './Markdown';

/**
 * Prose from the model. It writes markdown whether or not anyone asked it to,
 * so the block renders markdown — otherwise the asterisks around a number are
 * what the reader sees.
 */
export default function TextBlockView({ block }: { block: TextBlock }) {
  return (
    <div className="sv-a-b-text">
      <Markdown text={block.text} />
    </div>
  );
}
