import type { Chain } from '@svinooh/shared';

/**
 * One movement of value, as a source reported it and before anybody has decided
 * what it means.
 *
 * Deliberately not called a deposit or a withdrawal: `direction` says which way
 * it went relative to `address`, and nothing here says whether it crossed a
 * PORTFOLIO's edge — that is a verdict about a set of addresses, made in the
 * api, and the same row answers it differently for two portfolios.
 */
export interface RawTransfer {
  txHash: string;
  /** Which transfer this is inside its transaction — a swap has two */
  idx: number;
  minedAt: Date;
  direction: 'in' | 'out';
  /** The other side, already normalized; null where there is no single one */
  counterparty: string | null;
  /** The network it happened on: eth, arb, base, sol, tron, btc */
  network: string | null;
  /**
   * What the source called the transaction — send, receive, trade, deposit,
   * withdraw, claim, mint, approve…
   *
   * Kept verbatim rather than mapped onto words of our own. The classifier's
   * rules are written against these, and a mapping here would be a translation
   * step nobody could check against the source that produced it.
   */
  operation: string;
  symbol: string;
  /** Contract or mint address, where the asset has one */
  assetId: string | null;
  amount: number;
  /** The price AT minedAt — the whole reason this table exists */
  priceUsd: number | null;
  valueUsd: number | null;
}

/** One page of history, and where to ask for the next one */
export interface TransferPage {
  transfers: RawTransfer[];
  /**
   * The source's own cursor for the page after this one. Null — this was the
   * last page, and for an incremental read that means we have caught up.
   */
  next: string | null;
}

/**
 * Where one chain's transfers come from.
 *
 * The same shape as EVM_SOURCES in scanner-evm: a record over Chain, so a chain
 * without a reader does not compile rather than silently ingesting nothing.
 *
 * A source reads BACKWARDS — newest first — because that is what every one of
 * these APIs does natively, and because both jobs want it that way: an
 * incremental read stops as soon as it reaches what we already have, and a
 * backfill just keeps going.
 */
export interface FlowSource {
  /** The name rows are stamped with, so a bad reader can be found later */
  name: string;
  /**
   * Newest first. `until` is the point we already have history from — a page
   * whose transfers are all older than it need not be fetched again, and the
   * source may use it to bound the request. `cursor` continues a previous page.
   */
  read(address: string, opts: { until: Date | null; cursor: string | null; pageSize: number }): Promise<TransferPage>;
}

export type FlowSources = Record<Chain, FlowSource>;
