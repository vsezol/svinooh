/** A coin by its mint, and what to call it. */
export interface DepositCoin {
  mint: string;
  symbol: string;
}

/**
 * What a card asks the wallet to sign. `pool` is the pool the card is about —
 * where the money goes in a deposit and a move, where it comes out of in a
 * withdrawal; a move also says where it leaves. `payWith` is the coin a
 * deposit spends when that is not the pool's own token, and `receiveAs` the
 * coin a withdrawal ends as — each swapped on the way. `amount` is tokens of
 * what is spent, or "all".
 */
export interface DepositRequest {
  poolId: string;
  pool: string;
  protocol: string;
  poolKind: string;
  network: string;
  token: string;
  amount: string;
  action?: 'deposit' | 'withdraw' | 'move' | 'swap' | 'provide' | 'close' | 'rebalance';
  fromPoolId?: string;
  fromPool?: string;
  /** The token a move leaves in, when it is not the one it arrives as. */
  fromToken?: string;
  payWith?: DepositCoin;
  receiveAs?: DepositCoin;
  /**
   * Liquidity for a pair: the range as percent below and above the price;
   * `amountX`/`amountY` are what goes in of each once a swap has balanced
   * them; `position` is the one a close or a rebalance acts on.
   */
  belowPct?: string;
  abovePct?: string;
  amountX?: string;
  amountY?: string;
  position?: string;
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
      /**
       * Something in several transactions whose first landed and whose rest
       * did not: the money left where it was and is waiting in the wallet, as
       * `holding`.
       */
      halfway?: boolean;
      holding?: string;
    }
  | { ok: false; reason: string; at?: DepositStopped };
