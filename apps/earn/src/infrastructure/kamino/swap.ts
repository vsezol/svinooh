/**
 * Kamino Swap: one question to Kamino's meta-aggregator, which asks the
 * routers it knows (Jupiter, OKX, DFlow and the rest) and answers with each
 * route's instructions ready to compose — already simulated on its side, with
 * the lookup tables they were built against.
 *
 * Only routes that hand over instructions are any use here: some routers
 * answer with a whole transaction of their own, which cannot have a
 * withdrawal before it and a deposit after.
 */

const KSWAP = 'https://api.kamino.finance/kswap';

const TIMEOUT_MS = 15_000;

/** Wide enough for a price that moves between building and signing, narrow enough to leave little behind. */
export const SLIPPAGE_BPS = 30;

/** The smallest routes first when everything has to fit in one transaction. */
export const TIGHT = 8;

/** A route on its own can afford a better price for more accounts. */
export const ROOMY = 20;

export interface Route {
  router: string;
  instructions: unknown[];
  tables: Record<string, string[]>;
  /** The least the swap may pay out; below it the swap, and the transaction, fail. */
  guaranteed: bigint;
  expected: bigint;
}

export interface Asked {
  tokenIn: string;
  tokenOut: string;
  amount: bigint;
  owner: string;
  slippageBps: number;
  maxAccounts: number;
  /** Whether native SOL is wrapped going in and unwrapped coming out. */
  wrapSol: boolean;
}

interface WireIx {
  programId: string;
  data: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

interface WireRoute {
  routerType: string;
  transactionBs58?: string;
  simulationResult?: { success?: boolean };
  amountsExactIn: { amountOut: string; amountOutGuaranteed: string };
  instructions: {
    createInAtaIxs: WireIx[];
    createOutAtaIxs: WireIx[];
    wrapSolIxs: WireIx[];
    swapIxs: WireIx[];
    unwrapSolIxs: WireIx[];
  };
  lookupTableAccountsBs58?: { key: string; state: { addresses: string[] } }[];
}

/** Every composable route for this swap, the one that pays out most, surely, first. */
export async function kaminoRoutes(asked: Asked): Promise<Route[]> {
  const query = new URLSearchParams({
    tokenIn: asked.tokenIn,
    tokenOut: asked.tokenOut,
    amount: asked.amount.toString(),
    swapType: 'exactIn',
    executor: asked.owner,
    maxSlippageBps: String(asked.slippageBps),
    includeLimoLogs: 'false',
    // The accounts the swap pays from and into, created where they are missing:
    // without them a wallet that never held the output token fails the swap on
    // its first account check.
    includeSetupIxs: 'true',
    preferredMaxAccounts: String(asked.maxAccounts),
    wrapAndUnwrapSol: String(asked.wrapSol),
  });
  const answered = await fetch(`${KSWAP}/all-routes?${query}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!answered.ok) throw new Error(`kamino swap answered ${answered.status}`);
  const { data } = (await answered.json()) as { data?: WireRoute[] };
  const composable = (data ?? []).filter(
    (route) => !route.transactionBs58 && route.simulationResult?.success !== false,
  );
  const kit = await import('@solana/kit');
  const routes = composable.map((route): Route => {
    const parts = route.instructions;
    return {
      router: route.routerType,
      instructions: [
        ...parts.createInAtaIxs,
        ...parts.createOutAtaIxs,
        ...parts.wrapSolIxs,
        ...parts.swapIxs,
        ...parts.unwrapSolIxs,
      ].map((wire) => instruction(kit, wire)),
      tables: Object.fromEntries(
        (route.lookupTableAccountsBs58 ?? []).map((table) => [table.key, table.state.addresses]),
      ),
      guaranteed: BigInt(route.amountsExactIn.amountOutGuaranteed),
      expected: BigInt(route.amountsExactIn.amountOut),
    };
  });
  return routes.sort((a, b) => (b.guaranteed > a.guaranteed ? 1 : b.guaranteed < a.guaranteed ? -1 : 0));
}

const READONLY = 0;
const WRITABLE = 1;
const SIGNER = 2;

function instruction(kit: typeof import('@solana/kit'), wire: WireIx) {
  return {
    programAddress: kit.address(wire.programId),
    accounts: wire.keys.map((key) => ({
      address: kit.address(key.pubkey),
      role: (key.isSigner ? SIGNER : READONLY) + (key.isWritable ? WRITABLE : READONLY),
    })),
    data: Uint8Array.from(Buffer.from(wire.data, 'base64')),
  };
}
