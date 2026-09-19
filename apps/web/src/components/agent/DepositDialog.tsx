'use client';

import { useState } from 'react';
import { buildDeposit, type DepositOutcome, type DepositRequest } from '../../lib/deposit';
import { useDepositWallets, type DepositWallet } from '../../lib/deposit/wallet';
import { Button, Dialog, Note } from '../../ui';

type Stage = 'choosing' | 'building' | 'signing';

const STAGE: Record<Stage, string> = {
  choosing: '',
  building: 'Reading the pool and building the deposit…',
  signing: 'Waiting for your wallet…',
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
  const [failed, setFailed] = useState<string | null>(null);

  const deposit = async (wallet: DepositWallet) => {
    setFailed(null);
    let signer;
    try {
      signer = await wallet.connect();
    } catch (error) {
      setFailed(why(error, `${wallet.name} did not connect`));
      return;
    }
    try {
      setStage('building');
      const built = await buildDeposit(request, signer.address);
      setStage('signing');
      settle({ ok: true, signature: await signer.signAndSend(built.transaction) });
    } catch (error) {
      setStage('choosing');
      setFailed(why(error, 'the deposit was not sent'));
    }
  };

  return (
    <Dialog onClose={() => settle({ ok: false, reason: 'cancelled' })} title="Deposit">
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

function why(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : '';
  return said || fallback;
}
