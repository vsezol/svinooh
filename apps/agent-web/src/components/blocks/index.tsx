import type {
  AgentBlock,
  BarsBlock,
  ChartBlock,
  ConfirmBlock,
  NoteBlock,
  SignInBlock,
  StatsBlock,
  TableBlock,
  TextBlock,
} from '../../app/types';
import BarsBlockView from './BarsBlock';
import ChartBlockView from './ChartBlock';
import ConfirmBlockView, { type ConfirmAction } from './ConfirmBlock';
import NoteBlockView from './NoteBlock';
import SignInBlockView, { type SignInProvider } from './SignInBlock';
import StatsBlockView from './StatsBlock';
import TableBlockView from './TableBlock';
import TextBlockView from './TextBlock';
import UnsupportedBlock from './UnsupportedBlock';
import './blocks.css';

export type { ConfirmAction, SignInProvider };

export interface BlockViewProps {
  block: AgentBlock;
  /** Starts the auth flow chosen inside a signin block. */
  onSignIn?: (provider: SignInProvider) => void;
  /** Resolves a pending confirm block. */
  onAction?: (action: ConfirmAction) => void;
  /** A confirm action is in flight — locks the create button until it lands. */
  busy?: boolean;
}

export default function BlockView({ block, onSignIn, onAction, busy }: BlockViewProps) {
  // UnknownBlock widens `kind` to string, so the switch cannot narrow the
  // union on its own — each case asserts the member it matched.
  switch (block.kind) {
    case 'text':
      return <TextBlockView block={block as TextBlock} />;
    case 'stats':
      return <StatsBlockView block={block as StatsBlock} />;
    case 'chart':
      return <ChartBlockView block={block as ChartBlock} />;
    case 'table':
      return <TableBlockView block={block as TableBlock} />;
    case 'bars':
      return <BarsBlockView block={block as BarsBlock} />;
    case 'note':
      return <NoteBlockView block={block as NoteBlock} />;
    case 'signin':
      return <SignInBlockView block={block as SignInBlock} onSignIn={onSignIn} />;
    case 'confirm':
      return <ConfirmBlockView block={block as ConfirmBlock} onAction={onAction} busy={busy} />;
    default:
      return <UnsupportedBlock kind={block.kind} />;
  }
}
