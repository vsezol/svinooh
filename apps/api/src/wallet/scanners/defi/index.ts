import { Logger } from '@nestjs/common';
import { kaminoLending } from './kamino';
import { meteoraPools } from './meteora';
import { orcaPools } from './orca';
import type { DefiFacts, LendingFact, PoolFact } from '@svinooh/shared';

const logger = new Logger('DefiFacts');

/**
 * Runs a set of sources and records which of them could not be reached.
 *
 * Each is independent and each is allowed to fail: one that throws contributes
 * nothing and is named in `failed`, and the others still answer. That
 * distinction is the whole point — a source silent because it was unreachable
 * must never read as a source that said "no positions".
 */
async function gather(
  address: string,
  sources: Array<{ name: string; run: () => Promise<void> }>,
  failed: string[],
): Promise<void> {
  await Promise.all(
    sources.map(async ({ name, run }) => {
      try {
        await run();
      } catch (error) {
        failed.push(name);
        logger.warn(`${name} could not be read for ${address}: ${(error as Error).message}`);
      }
    }),
  );
}

/**
 * The pools a wallet holds, from the protocols that run them. Cheap enough to
 * ask on every sync — Meteora is one or two requests and Orca is two RPC calls
 * and one — so this runs alongside the aggregator rather than after it.
 */
export async function solanaPoolFacts(address: string): Promise<DefiFacts> {
  const pools: PoolFact[] = [];
  const failed: string[] = [];
  await gather(
    address,
    [
      { name: 'orca', run: async () => void pools.push(...(await orcaPools(address))) },
      { name: 'meteora', run: async () => void pools.push(...(await meteoraPools(address))) },
    ],
    failed,
  );
  return { pools, lending: [], failed };
}

/**
 * Kamino, asked only when the aggregator left a loan unexplained.
 *
 * It is not cheap: 38 markets, and a wallet nobody has looked up before has to
 * be asked about all of them. Jupiter covers Kamino and usually reports both
 * the health and the rate, so the usual answer to "is this needed" is no, and
 * the cost is not paid. When it is needed, the markets that answered are
 * remembered and the next pass asks only those.
 */
export async function solanaLendingFacts(address: string): Promise<DefiFacts> {
  const lending: LendingFact[] = [];
  const failed: string[] = [];
  await gather(
    address,
    [{ name: 'kamino', run: async () => void lending.push(...(await kaminoLending(address))) }],
    failed,
  );
  return { pools: [], lending, failed };
}
