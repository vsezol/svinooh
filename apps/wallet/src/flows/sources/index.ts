import { mempoolTransfers } from './mempool';
import { trongridTransfers } from './trongrid';
import { zerionTransfers } from './zerion';
import type { FlowSources } from './source';

export * from './source';

/**
 * Where each chain's transfers are read from.
 *
 * Typed as a Record over Chain, the same way EVM_SOURCES is typed over its
 * setting's options: a chain added to the enum without a reader here stops the
 * build, rather than quietly ingesting nothing and drawing a corrected line
 * that is missing a wallet's worth of movement.
 *
 * EVM and SOL share one reader on purpose — Zerion's transactions endpoint
 * takes either kind of address and answers in one schema, and it is the only
 * one of the three that returns the price at the time of the transaction
 * without a second lookup.
 */
export const FLOW_SOURCES: FlowSources = {
  EVM: zerionTransfers,
  SOL: zerionTransfers,
  TRON: trongridTransfers,
  BTC: mempoolTransfers,
};
