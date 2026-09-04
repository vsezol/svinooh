import { apiSource } from './api';
import { browserSource } from './browser';
import type { EvmSource, EvmSourceId } from './source';

export * from './source';

/**
 * Every strategy, addressed by the value the setting takes.
 *
 * Typed as a Record over the setting's own options, so this table cannot fall
 * out of step with the registry: declare a new option and the build fails until
 * it has an implementation here.
 */
export const EVM_SOURCES: Record<EvmSourceId, EvmSource> = {
  browser: browserSource,
  api: apiSource,
};
