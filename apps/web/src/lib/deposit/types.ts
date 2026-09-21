/**
 * What a card asks the wallet to sign. `pool` is the pool the card is about —
 * where the money goes in a deposit and a move, where it comes out of in a
 * withdrawal; a move also says where it leaves. `amount` is tokens, or "all".
 */
export interface DepositRequest {
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: string;
  network: string;
  token: string;
  amount: string;
  action?: 'deposit' | 'withdraw' | 'move';
  fromPoolId?: string;
  fromPool?: string;
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
