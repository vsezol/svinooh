'use client';

import { useState } from 'react';
import {
  buildDeposit,
  followDeposit,
  type DepositOutcome,
  type DepositRequest,
} from '../../lib/deposit';
import { useDepositWallets, type DepositWallet } from '../../lib/deposit/wallet';
import { Button, Dialog, Note } from '../../ui';

type Stage = 'choosing' | 'building' | 'signing' | 'landing';

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
      const signature = await signer.signAndSend(built.transaction);
      setSent(signature);
      setStage('landing');
      const seen = await followDeposit(signature, signer.address, request.network).catch(
        () => null,
      );
      settle({
        ok: true,
        signature,
        landed: seen?.status,
        tracked: seen?.tracked,
        error: seen?.error ?? null,
      });
    } catch (error) {
      setStage('choosing');
      setFailed(why(error, 'the deposit was not sent'));
    }
  };

  return (
    <Dialog
      onClose={() =>
        settle(
          sent
            ? { ok: true, signature: sent, landed: 'pending' }
            : { ok: false, reason: 'cancelled' },
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

function why(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : '';
  return said || fallback;
}
