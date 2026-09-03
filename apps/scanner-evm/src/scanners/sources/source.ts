import type { ChoiceOf } from '@svinooh/common';
import type { ScanResult } from '@svinooh/shared';

/**
 * Where an EVM address's balances come from.
 *
 * One interface, one implementation per option the registry offers, chosen per
 * scan rather than per deploy — so switching the source in the admin takes
 * effect on the next wallet.
 *
 * The id is typed as the setting's own options, and the table below is a
 * `Record` over them: adding an option to the registry stops the build until
 * something implements it, and removing one stops the build until the dead
 * implementation goes. Neither can be forgotten.
 */
export type EvmSourceId = ChoiceOf<'scan.evmSource'>;

export interface EvmSource {
  id: EvmSourceId;
  /** How it is described in a log line, when a scan says where its number came from */
  label: string;
  read(address: string): Promise<ScanResult>;
}
