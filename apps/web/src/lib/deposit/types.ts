export interface DepositRequest {
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: string;
  network: string;
  token: string;
  amount: string;
}

export type DepositOutcome = { ok: true; signature?: string } | { ok: false; reason: string };
