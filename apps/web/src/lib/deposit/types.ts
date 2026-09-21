export interface DepositRequest {
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: string;
  network: string;
  token: string;
  amount: string;
}

export type DepositLanding = 'pending' | 'landed' | 'failed';

/** How far a deposit got before it stopped. */
export type DepositStopped = 'connect' | 'build' | 'wallet' | 'cancelled';

export type DepositOutcome =
  | {
      ok: true;
      signature?: string;
      landed?: DepositLanding;
      tracked?: boolean;
      error?: string | null;
    }
  | { ok: false; reason: string; at?: DepositStopped };
