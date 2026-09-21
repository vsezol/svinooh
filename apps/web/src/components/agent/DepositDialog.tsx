'use client';

import { useState } from 'react';
import type { DepositOutcome, DepositRequest } from '../../lib/deposit';
import { runDeposit, type DepositStage } from '../../lib/deposit/run';
import { useDepositWallets, type DepositWallet } from '../../lib/deposit/wallet';
import { Button, Dialog, Note } from '../../ui';

type Stage = 'choosing' | DepositStage;

const STAGE: Record<Stage, string> = {
  choosing: '',
  building: 'Reading the pool and building the deposit…',
  signing: 'Waiting for your wallet…',
  landing: 'Sent. Waiting for the network to confirm it…',
  continuing: 'The swap landed. Preparing the deposit, the second signature…',
};

export function DepositDialog({
  request,
  settle,
}: {
  request: DepositRequest;
  settle: (outcome: DepositOutcome) => void;
}) {
  const wallets = useDepositWallets();
  const [stage, setStage] = useState<Stage>('choosing');
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const deposit = async (wallet: DepositWallet) => {
    setFailed(null);
    const run = await runDeposit({ request, wallet, onStage: setStage, onSent: setSent });
    if ('failed' in run) {
      setStage('choosing');
      setFailed(run.failed);
      return;
    }
    settle(run.done);
  };

  return (
    <Dialog
      onClose={() =>
        settle(
          sent
            ? { ok: true, signature: sent, landed: 'pending' }
            : { ok: false, reason: 'cancelled', at: 'cancelled' },
        )
      }
      title={TITLE[request.action ?? 'deposit']}
    >
      <Note>{saying(request)} You sign it; nothing happens until you do.</Note>
      {stage === 'choosing' ? (
        <div style={{ marginTop: 'var(--sp-6)', display: 'grid', gap: 'var(--sp-4)' }}>
          {wallets.map((wallet) => (
            <Button key={wallet.id} variant="soft" size="lg" block onClick={() => deposit(wallet)}>
              {wallet.name}
            </Button>
          ))}
          {wallets.length === 0 ? (
            <Note style={{ color: 'var(--down)' }}>
              No Solana wallet in this browser can send a transaction. Phantom, Solflare and
              Backpack can.
            </Note>
          ) : null}
        </div>
      ) : (
        <Note>{STAGE[stage]}</Note>
      )}
      {failed ? <Note style={{ color: 'var(--down)' }}>{failed}</Note> : null}
    </Dialog>
  );
}

const TITLE = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  move: 'Move',
  swap: 'Swap',
  provide: 'Add liquidity',
  close: 'Close position',
  rebalance: 'Rebalance',
} as const;

function saying(request: DepositRequest): string {
  const spent = request.payWith?.symbol ?? request.fromToken ?? request.token;
  const how = request.amount === 'all' ? `All of your ${spent}` : `${request.amount} ${spent}`;
  const leaves = `The money leaves your wallet for ${request.protocol} and never touches svinooh.`;
  switch (request.action) {
    case 'withdraw':
      return request.receiveAs
        ? `${how} out of ${request.pool}, swapped to ${request.receiveAs.symbol} on the way back to your wallet.`
        : `${how} out of ${request.pool}, back to your wallet.`;
    case 'move':
      return `${how} out of ${request.fromPool ?? 'the pool it is in'} and into ${request.pool}.`;
    case 'swap':
      return `${how} swapped to ${request.receiveAs?.symbol ?? 'another coin'}, in your wallet.`;
    case 'provide':
      return `${how} into ${request.pool}, from ${request.belowPct}% below the price to ${request.abovePct}% above it. ${leaves}`;
    case 'close':
      return `Everything in your ${request.pool} position back to your wallet, with its fees.`;
    case 'rebalance':
      return `Your ${request.pool} position closed and placed again around the price. ${leaves}`;
    default:
      return request.payWith
        ? `${how}, swapped to ${request.token} on the way into ${request.pool}. ${leaves}`
        : `${how} into ${request.pool}. ${leaves}`;
  }
}
