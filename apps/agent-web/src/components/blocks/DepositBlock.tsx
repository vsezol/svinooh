import { useState } from 'react';
import type { DepositBlock, DepositOutcome, DepositRequest } from '../../app/types';

type State = 'idle' | 'working' | 'signed' | 'refused';

interface Props {
  block: DepositBlock;
  onDeposit?: (request: DepositRequest) => Promise<DepositOutcome | void> | void;
}

export function afterDeposit(outcome: DepositOutcome | void): { state: State; note: string | null } {
  if (outcome && outcome.ok === false) return { state: 'refused', note: outcome.reason };
  if (outcome && outcome.ok) return { state: 'signed', note: outcome.signature ?? null };
  return { state: 'signed', note: null };
}

export const requestOf = (block: DepositBlock): DepositRequest => ({
  poolId: block.poolId,
  pool: block.pool,
  protocol: block.protocol,
  poolKind: block.poolKind,
  network: block.network,
  token: block.token,
  amount: block.amount,
  accounts: block.accounts,
});

export default function DepositBlockView({ block, onDeposit }: Props) {
  const [state, setState] = useState<State>('idle');
  const [note, setNote] = useState<string | null>(null);

  const sign = async () => {
    if (!onDeposit || state === 'working') return;
    setState('working');
    setNote(null);
    try {
      const settled = afterDeposit(await onDeposit(requestOf(block)));
      setState(settled.state);
      setNote(settled.note);
    } catch (error) {
      setState('refused');
      setNote(error instanceof Error ? error.message : 'the wallet did not sign it');
    }
  };

  return (
    <div className="sv-a-b-card sv-a-b-deposit" data-state={state}>
      <div className="sv-a-b-eyebrow">PROPOSED DEPOSIT</div>
      <div className="sv-a-b-deposit-head">
        <span className="sv-a-b-deposit-size mono">
          {block.amount} {block.token}
        </span>
        <span className="sv-a-b-deposit-rate mono">{block.apy}</span>
      </div>
      <div className="sv-a-b-deposit-where">
        <a href={block.url} target="_blank" rel="noopener noreferrer">
          {block.pool}
        </a>
        <span className="sv-a-b-deposit-meta mono">
          {block.protocol} · {block.network} · risk {block.risk}
        </span>
      </div>
      <div className="sv-a-b-deposit-foot">
        {state === 'signed' ? (
          <span className="sv-a-b-deposit-done mono">Signed{note ? ` · ${note}` : ''}</span>
        ) : (
          <button
            type="button"
            className="ui-btn"
            data-variant="accent"
            data-size="md"
            onClick={sign}
            disabled={!onDeposit || state === 'working'}
          >
            {state === 'working' ? 'Waiting for your wallet…' : 'Deposit from my wallet'}
          </button>
        )}
        <span className="sv-a-b-deposit-note mono">
          {!onDeposit
            ? 'No wallet is connected here — open it on svinooh.com to sign.'
            : state === 'refused'
              ? (note ?? 'not signed')
              : 'Your money goes straight to the protocol. Nothing moves until you sign.'}
        </span>
      </div>
    </div>
  );
}
