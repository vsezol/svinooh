'use client';

import { useCallback, useState } from 'react';
import type { DepositOutcome, DepositRequest } from '../../lib/deposit';

interface Asked {
  request: DepositRequest;
  settle: (outcome: DepositOutcome) => void;
}

export function useDeposits() {
  const [asked, setAsked] = useState<Asked | null>(null);

  const onDeposit = useCallback(
    (request: DepositRequest) =>
      new Promise<DepositOutcome>((resolve) => {
        setAsked({
          request,
          settle: (outcome) => {
            setAsked(null);
            resolve(outcome);
          },
        });
      }),
    [],
  );

  return { onDeposit, asked };
}
