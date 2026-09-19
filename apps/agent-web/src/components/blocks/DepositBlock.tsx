import { useState } from 'react';
import type { DepositBlock, DepositOutcome, DepositRequest } from '../../app/types';

type State = 'idle' | 'working' | 'signed' | 'landed' | 'refused';

interface Settled {
  state: State;
  note: string | null;
  signature: string | null;
}

interface Props {
  block: DepositBlock;
  onDeposit?: (request: DepositRequest) => Promise<DepositOutcome | void> | void;
}

const REJECTED = 'the network rejected it — nothing left your wallet';

export function afterDeposit(outcome: DepositOutcome | void): Settled {
  if (outcome && outcome.ok === false) {
    return { state: 'refused', note: outcome.reason, signature: null };
  }
  if (!outcome) return { state: 'signed', note: null, signature: null };
  const signature = outcome.signature ?? null;
  if (outcome.landed === 'failed') {
    return { state: 'refused', note: outcome.error ?? REJECTED, signature };
  }
  if (outcome.landed === 'landed') {
    return {
      state: 'landed',
      note: outcome.tracked
        ? 'your portfolio is being read again right now'
        : 'this address is not in your portfolio, so it will not show up there',
      signature,
    };
  }
  if (outcome.landed === 'pending') {
    return { state: 'signed', note: 'the network has not confirmed it yet', signature };
  }
  return { state: 'signed', note: signature, signature };
}

export const requestOf = (block: DepositBlock): DepositRequest => ({
  poolId: block.poolId,
  pool: block.pool,
  protocol: block.protocol,
  poolKind: block.poolKind,
  network: block.network,
  token: block.token,
  amount: block.amount,
});

export default function DepositBlockView({ block, onDeposit }: Props) {
  const [settled, setSettled] = useState<Settled>({ state: 'idle', note: null, signature: null });
  const { state, note, signature } = settled;

  const sign = async () => {
    if (!onDeposit || state === 'working') return;
    setSettled({ state: 'working', note: null, signature: null });
    try {
      setSettled(afterDeposit(await onDeposit(requestOf(block))));
    } catch (error) {
      setSettled({
        state: 'refused',
        note: error instanceof Error ? error.message : 'the wallet did not sign it',
        signature: null,
      });
    }
  };

  const done = state === 'signed' || state === 'landed';
  const says = !onDeposit
    ? 'No wallet is connected here — open it on svinooh.com to sign.'
    : state === 'refused'
      ? (note ?? 'not signed')
      : done
        ? null
        : 'Your money goes straight to the protocol. Nothing moves until you sign.';

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
        {done ? (
          <span className="sv-a-b-deposit-done mono">
            {state === 'landed' ? 'Landed' : 'Signed'}
            {note ? ` · ${note}` : ''}
          </span>
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
        {says ? <span className="sv-a-b-deposit-note mono">{says}</span> : null}
        {signature && block.network === 'sol' ? (
          <a
            className="sv-a-b-deposit-tx mono"
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {signature.slice(0, 8)}…{signature.slice(-8)}
          </a>
        ) : null}
      </div>
    </div>
  );
}
