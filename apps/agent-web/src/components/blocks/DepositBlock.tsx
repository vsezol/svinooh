import { useState } from 'react';
import type { DepositBlock, DepositOutcome, DepositRequest, Settled } from '../../app/types';

type State = 'idle' | 'working' | 'signed' | 'landed' | 'refused';

interface Shown {
  state: State;
  note: string | null;
  signature: string | null;
}

interface Props {
  block: DepositBlock;
  onDeposit?: (request: DepositRequest) => Promise<DepositOutcome | void> | void;
}

const REJECTED = 'the network rejected it — nothing left your wallet';

export function afterDeposit(outcome: DepositOutcome | void): Shown {
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

/**
 * What there is to tell the agent about a deposit, or nothing.
 *
 * A wallet somebody closed is not news — they know, they closed it. A build
 * the server would not make is: it knows why, in words, and the reason is
 * usually something they can act on.
 */
export function settledOf(
  request: DepositRequest,
  outcome: DepositOutcome | void,
): Settled | null {
  const { spent, ends } = coinsOf(request);
  const what = {
    amount: request.amount,
    token: spent,
    pool: request.pool,
    action: request.action ?? 'deposit',
    from_pool: request.fromPool ?? null,
    ...(ends !== spent ? { into: ends } : {}),
  };
  if (!outcome) return null;
  if (outcome.ok === false) {
    return outcome.at === 'build'
      ? { ...what, status: 'refused', signature: null, error: outcome.reason }
      : null;
  }
  if (!outcome.signature) return null;
  const status =
    outcome.landed === 'landed' ? 'landed' : outcome.landed === 'failed' ? 'failed' : 'sent';
  return {
    ...what,
    status,
    signature: outcome.signature,
    error: status === 'failed' || outcome.halfway ? (outcome.error ?? null) : null,
    ...(outcome.halfway ? { halfway: true, holding: outcome.holding ?? null } : {}),
  };
}

/**
 * What a card spends and what it ends as: the coin it pays with, or the
 * token a move leaves, or the pool's own — and the coin a withdrawal is taken
 * out as, or the pool's own.
 */
const coinsOf = (card: {
  token: string;
  fromToken?: string | null;
  payWith?: { symbol: string } | null;
  receiveAs?: { symbol: string } | null;
}) => ({
  spent: card.payWith?.symbol ?? card.fromToken ?? card.token,
  ends: card.receiveAs?.symbol ?? card.token,
});

export const requestOf = (block: DepositBlock): DepositRequest => ({
  poolId: block.poolId,
  pool: block.pool,
  protocol: block.protocol,
  poolKind: block.poolKind,
  network: block.network,
  token: block.token,
  amount: block.amount,
  action: block.action ?? 'deposit',
  ...(block.fromPoolId ? { fromPoolId: block.fromPoolId } : {}),
  ...(block.fromPool ? { fromPool: block.fromPool } : {}),
  ...(block.fromToken ? { fromToken: block.fromToken } : {}),
  ...(block.payWith ? { payWith: block.payWith } : {}),
  ...(block.receiveAs ? { receiveAs: block.receiveAs } : {}),
});

const EYEBROW = {
  deposit: 'PROPOSED DEPOSIT',
  withdraw: 'PROPOSED WITHDRAWAL',
  move: 'PROPOSED MOVE',
} as const;

const PRESS = {
  deposit: 'Deposit from my wallet',
  withdraw: 'Withdraw to my wallet',
  move: 'Move it',
} as const;

const PROMISE = {
  deposit: 'Your money goes straight to the protocol.',
  withdraw: 'The money comes back to your wallet.',
  move: 'Out of one pool and into the other.',
} as const;

/**
 * What the card promises under its button. A swap on the way is said, and so
 * is what it can cost in taps: when one transaction cannot hold it all, the
 * wallet asks for a signature per step.
 */
export const promiseOf = (block: DepositBlock): string => {
  const { spent, ends } = coinsOf(block);
  const swapped =
    spent !== ends
      ? ` ${spent} becomes ${ends} on the way, and your wallet may ask you to sign more than once.`
      : '';
  return `${PROMISE[block.action ?? 'deposit']}${swapped} Nothing moves until you sign.`;
};

/**
 * What the card shows as its amount: the figure, even when what it asks for is
 * "all", in the token it is counted in — what it spends — and, when it swaps,
 * what that becomes.
 */
export const sizeOf = (block: DepositBlock): string => {
  const { spent, ends } = coinsOf(block);
  const figure = block.amount === 'all' ? (block.shown ?? 'All') : block.amount;
  return `${figure} ${spent}${ends !== spent ? ` → ${ends}` : ''}`;
};

export default function DepositBlockView({ block, onDeposit }: Props) {
  const [shown, setShown] = useState<Shown>({ state: 'idle', note: null, signature: null });
  const { state, note, signature } = shown;

  const sign = async () => {
    if (!onDeposit || state === 'working') return;
    setShown({ state: 'working', note: null, signature: null });
    try {
      setShown(afterDeposit(await onDeposit(requestOf(block))));
    } catch (error) {
      setShown({
        state: 'refused',
        note: error instanceof Error ? error.message : 'the wallet did not sign it',
        signature: null,
      });
    }
  };

  const action = block.action ?? 'deposit';
  const done = state === 'signed' || state === 'landed';
  const says = !onDeposit
    ? 'No wallet is connected here — open it on svinooh.com to sign.'
    : state === 'refused'
      ? (note ?? 'not signed')
      : done
        ? null
        : promiseOf(block);

  return (
    <div className="sv-a-b-card sv-a-b-deposit" data-state={state}>
      <div className="sv-a-b-eyebrow">{EYEBROW[action]}</div>
      <div className="sv-a-b-deposit-head">
        <span className="sv-a-b-deposit-size mono">{sizeOf(block)}</span>
        <span className="sv-a-b-deposit-rate mono">
          {action === 'move' && block.fromApy ? `${block.fromApy} → ${block.apy}` : block.apy}
        </span>
      </div>
      <div className="sv-a-b-deposit-where">
        {action === 'move' && block.fromPool ? <span>{block.fromPool} → </span> : null}
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
            {state === 'working' ? 'Waiting for your wallet…' : PRESS[action]}
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
