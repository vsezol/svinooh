import type {
  AgentBlock,
  BarsBlock,
  ChartBlock,
  ChoiceBlock,
  ConfirmBlock,
  DepositBlock,
  DepositOutcome,
  DepositRequest,
  LinksBlock,
  NoteBlock,
  SignInBlock,
  StatsBlock,
  TableBlock,
  TextBlock,
  TraceBlock,
} from '../../app/types';
import BarsBlockView from './BarsBlock';
import ChartBlockView from './ChartBlock';
import ChoiceBlockView from './ChoiceBlock';
import ConfirmBlockView, { type ConfirmAction } from './ConfirmBlock';
import DepositBlockView from './DepositBlock';
import LinksBlockView from './LinksBlock';
import NoteBlockView from './NoteBlock';
import SignInBlockView, { type SignInProvider } from './SignInBlock';
import StatsBlockView from './StatsBlock';
import TableBlockView from './TableBlock';
import TextBlockView from './TextBlock';
import TraceBlockView from './TraceBlock';
import UnsupportedBlock from './UnsupportedBlock';

export type { ConfirmAction, SignInProvider };

export interface BlockViewProps {
  block: AgentBlock;
  /** Starts the auth flow chosen inside a signin block. */
  onSignIn?: (provider: SignInProvider) => void;
  /** Resolves a pending confirm block. */
  onAction?: (action: ConfirmAction) => void;
  /** A confirm action is in flight — locks the create button until it lands. */
  busy?: boolean;
  /** Opens or folds the step-by-step trace above a finished answer. */
  onToggleTrace?: () => void;
  /** Follows one of the places an answer leads. */
  onFollow?: (href: string) => void;
  onDeposit?: (request: DepositRequest) => Promise<DepositOutcome | void> | void;
  /** Answers a question the agent put up as buttons. */
  onChoose?: (answer: string) => void;
}

export default function BlockView({
  block,
  onSignIn,
  onAction,
  busy,
  onToggleTrace,
  onFollow,
  onDeposit,
  onChoose,
}: BlockViewProps) {
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
    case 'trace':
      return <TraceBlockView block={block as TraceBlock} onToggle={onToggleTrace} />;
    case 'links':
      return <LinksBlockView block={block as LinksBlock} onFollow={onFollow} />;
    case 'signin':
      return <SignInBlockView block={block as SignInBlock} onSignIn={onSignIn} />;
    case 'deposit':
      return <DepositBlockView block={block as DepositBlock} onDeposit={onDeposit} />;
    case 'choice':
      return <ChoiceBlockView block={block as ChoiceBlock} onChoose={onChoose} />;
    case 'confirm':
      return <ConfirmBlockView block={block as ConfirmBlock} onAction={onAction} busy={busy} />;
    default:
      return <UnsupportedBlock kind={block.kind} />;
  }
}
