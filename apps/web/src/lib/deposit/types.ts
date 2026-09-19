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

export type DepositOutcome =
  | {
      ok: true;
      signature?: string;
      landed?: DepositLanding;
      tracked?: boolean;
      error?: string | null;
    }
  | { ok: false; reason: string };
