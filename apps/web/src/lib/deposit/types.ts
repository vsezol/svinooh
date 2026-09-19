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
  poolKind: 'vault' | 'reserve';
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
