'use client';

import { useCallback, useState } from 'react';
import type { DepositOutcome, DepositRequest } from '../../lib/deposit';
import { runDeposit } from '../../lib/deposit/run';
import { useDepositWallets } from '../../lib/deposit/wallet';

interface Asked {
  request: DepositRequest;
  settle: (outcome: DepositOutcome) => void;
  onLanded?: () => void;
}

/**
 * One wallet is not a choice. Asking which of one to use puts a dialog and a
 * second tap between the button and the thing the button said it would do, so
 * where there is nothing to pick the deposit goes straight to the wallet and
 * the card carries the waiting and whatever comes back.
 */
export function useDeposits(onLanded?: () => void) {
  const wallets = useDepositWallets();
  const [asked, setAsked] = useState<Asked | null>(null);

  const onDeposit = useCallback(
    async (request: DepositRequest): Promise<DepositOutcome> => {
      const [only] = wallets;
      if (wallets.length === 1) {
        const run = await runDeposit({ request, wallet: only, onLanded });
        return 'failed' in run ? { ok: false, reason: run.failed, at: run.at } : run.done;
      }
      return new Promise<DepositOutcome>((resolve) => {
        setAsked({
          request,
          onLanded,
          settle: (outcome) => {
            setAsked(null);
            resolve(outcome);
          },
        });
      });
    },
    [wallets, onLanded],
  );

  return { onDeposit, asked };
}
