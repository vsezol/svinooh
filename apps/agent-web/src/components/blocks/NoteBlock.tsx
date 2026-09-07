import type { NoteBlock } from '../../app/types';

export default function NoteBlockView({ block }: { block: NoteBlock }) {
  return <div className="sv-a-b-note">{block.text}</div>;
}
