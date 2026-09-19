export interface DepositAccounts {
  programId: string;
  address: string;
  tokenMint: string;
  tokenDecimals?: number | null;
  sharesMint?: string | null;
  sharesDecimals?: number | null;
  tokenProgram?: string | null;
  lendingMarket?: string | null;
}

export interface DepositRequest {
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: string;
  network: string;
  token: string;
  amount: string;
  accounts: DepositAccounts;
}

export interface BuiltDeposit {
  transaction: string;
  feePayer: string;
  instructions: number;
  blockhash: string;
  lastValidBlockHeight: string;
}

export type DepositOutcome = { ok: true; signature?: string } | { ok: false; reason: string };

export class DepositNotSupportedError extends Error {}

export type BuildDeposit = (
  request: DepositRequest,
  owner: string,
  rpcUrl: string,
) => Promise<BuiltDeposit>;
