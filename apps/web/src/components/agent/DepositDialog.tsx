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
      title="Deposit"
    >
      <Note>
        {request.amount} {request.token} into {request.pool}. The money leaves your wallet for{' '}
        {request.protocol} and never touches svinooh. You sign it; nothing happens until you do.
      </Note>
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
