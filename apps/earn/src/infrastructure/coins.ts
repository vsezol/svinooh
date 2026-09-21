import { Logger } from '@nestjs/common';
import type { FindCoin } from '../application/coins';
import type { Coin } from '../domain/move';

/**
 * Jupiter's directory of Solana tokens: a mint's ticker, places and program,
 * and whether Jupiter has verified it. It answers a search by ticker and a
 * list of mints alike, without a key.
 */
const DIRECTORY = 'https://datapi.jup.ag/v1/assets/search';

const TIMEOUT_MS = 10_000;

/** Mints asked about in one go; the directory answers a longer list with nothing. */
const CHUNK = 30;

/** How long what the directory said about a mint is taken as still true. */
const KEPT_MS = 10 * 60_000;

const NATIVE = 'So11111111111111111111111111111111111111112';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const SOL: Coin = { symbol: 'SOL', mint: NATIVE, decimals: 9, program: TOKEN };

interface Listed {
  id: string;
  symbol?: string;
  decimals?: number;
  tokenProgram?: string;
  isVerified?: boolean;
  liquidity?: number;
}

const known = new Map<string, { at: number; listed: Listed }>();

/**
 * A coin on Solana by its mint or its ticker.
 *
 * A mint is taken as asked — it names one token and nothing else. A ticker
 * answers with a verified coin, one these wallets hold before one they do
 * not: anybody can mint a token and call it anything, and a swap into the
 * wrong one under the right name is money handed to whoever minted it. A coin
 * nobody verified answers to its ticker only for somebody who holds it and
 * when no verified coin has that name — it is theirs to spend.
 */
export const coinsVia =
  (rpcUrl: string): FindCoin =>
  async (query, owners) => {
    const asked = query.trim();
    if (asked.toUpperCase() === 'SOL' || asked === NATIVE) return SOL;
    if (MINT.test(asked)) return byMint(rpcUrl, asked);
    const ticker = asked.toLowerCase();
    const named = (one: Listed) => one.symbol?.toLowerCase() === ticker;
    const held = (await described(await mintsHeld(rpcUrl, owners))).filter(named);
    const heldVerified = held.filter((one) => one.isVerified);
    if (heldVerified.length) return coinOf(deepest(heldVerified));
    const listed = (await directory(asked)).filter((one) => named(one) && one.isVerified);
    if (listed.length) return coinOf(deepest(listed));
    return held.length ? coinOf(deepest(held)) : null;
  };

async function byMint(rpcUrl: string, mint: string): Promise<Coin | null> {
  const [listed] = await described([mint]);
  if (listed?.decimals !== undefined) return coinOf(listed);
  const kit = await import('@solana/kit');
  const { value } = await kit
    .createSolanaRpc(rpcUrl)
    .getAccountInfo(kit.address(mint), { encoding: 'jsonParsed' })
    .send();
  const decimals = (value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed
    ?.info?.decimals;
  if (!value || decimals === undefined) return null;
  return { symbol: `${mint.slice(0, 4)}…`, mint, decimals, program: String(value.owner) };
}

/** Every mint these wallets hold some of, under either token program. */
async function mintsHeld(rpcUrl: string, owners: readonly string[]): Promise<string[]> {
  if (!owners.length) return [];
  const kit = await import('@solana/kit');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const read = (owner: string, program: string) =>
    rpc
      .getTokenAccountsByOwner(
        kit.address(owner),
        { programId: kit.address(program) },
        { encoding: 'jsonParsed' },
      )
      .send()
      .then(({ value }) =>
        value
          .map((one) => one.account.data.parsed.info)
          .filter((info) => info.tokenAmount.amount !== '0')
          .map((info) => String(info.mint)),
      )
      .catch((unreachable) => {
        new Logger('Coins').warn(
          `could not read the tokens of ${owner.slice(0, 6)}…: ${String(unreachable)}`,
        );
        return [] as string[];
      });
  const found = await Promise.all(
    owners.flatMap((owner) => [read(owner, TOKEN), read(owner, TOKEN_2022)]),
  );
  return [...new Set(found.flat())];
}

/** What the directory says about each of these mints, from memory where it said it lately. */
async function described(mints: string[]): Promise<Listed[]> {
  const fresh = (mint: string) => (known.get(mint)?.at ?? 0) > Date.now() - KEPT_MS;
  const asked = mints.filter((mint) => !fresh(mint));
  for (let at = 0; at < asked.length; at += CHUNK) {
    for (const listed of await directory(asked.slice(at, at + CHUNK).join(','))) {
      known.set(listed.id, { at: Date.now(), listed });
    }
  }
  return mints.flatMap((mint) => {
    const listed = known.get(mint)?.listed;
    return listed ? [listed] : [];
  });
}

async function directory(query: string): Promise<Listed[]> {
  try {
    const answered = await fetch(`${DIRECTORY}?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!answered.ok) throw new Error(`the directory answered ${answered.status}`);
    const found = (await answered.json()) as unknown;
    return Array.isArray(found) ? (found as Listed[]) : [];
  } catch (unreachable) {
    new Logger('Coins').warn(
      `could not search the directory for ${query.slice(0, 40)}: ${String(unreachable)}`,
    );
    return [];
  }
}

const deepest = (listed: Listed[]): Listed =>
  listed.reduce((best, one) => ((one.liquidity ?? 0) > (best.liquidity ?? 0) ? one : best));

const coinOf = (listed: Listed): Coin | null =>
  listed.decimals === undefined
    ? null
    : {
        symbol: listed.symbol || `${listed.id.slice(0, 4)}…`,
        mint: listed.id,
        decimals: listed.decimals,
        program: listed.tokenProgram || TOKEN,
      };
