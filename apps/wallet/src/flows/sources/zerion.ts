import { Logger } from '@nestjs/common';
import { config } from '../../config';
import type { FlowSource, RawTransfer, TransferPage } from './source';

const logger = new Logger('ZerionTransfers');
const API = 'https://api.zerion.io/v1';

/**
 * Transfers from the Zerion API — the same account that already serves EVM
 * balances (see scanner-evm's zerion.ts), and the same Basic auth.
 *
 * One endpoint covers EVM and Solana both: `/wallets/{address}/transactions`
 * takes either kind of address and answers in one schema. That is why SOL
 * transfers do not come from Jupiter, which serves SOL balances — Jupiter has
 * no transaction history to give, and a second reader for one chain would be a
 * second set of quirks to learn.
 *
 * What makes it worth the key: every transfer carries `price` and `value` AT
 * THE TIME IT WAS MINED. Deriving that ourselves would mean a historical price
 * lookup per asset per timestamp, which is what the TRON and BTC readers have
 * to do and what makes them the slow ones.
 *
 * Two things about the response are worth knowing before changing this:
 *
 *  - `operation_type` is the transaction's PRIMARY action, and one transaction
 *    can carry several transfers under it. A swap is one `trade` with an `out`
 *    leg and an `in` leg. Every leg is stored, tagged with the operation of the
 *    transaction it belongs to — the classifier needs the operation, not the
 *    leg, to know that no value crossed anything.
 *  - `value` is nullable and genuinely comes back null, for an asset Zerion
 *    cannot price. That is stored as null and not as zero: a flow nobody can
 *    price must not quietly net a real balance step down to nothing.
 */

interface ZerionTxTransfer {
  direction?: string;
  sender?: string | null;
  recipient?: string | null;
  quantity?: { float?: number };
  value?: number | null;
  price?: number | null;
  fungible_info?: {
    symbol?: string | null;
    name?: string | null;
    implementations?: Array<{ chain_id?: string; address?: string | null }>;
  };
}

interface ZerionTx {
  attributes?: {
    operation_type?: string;
    hash?: string;
    mined_at?: string;
    status?: string;
    sent_from?: string | null;
    sent_to?: string | null;
    transfers?: ZerionTxTransfer[];
  };
  relationships?: { chain?: { data?: { id?: string } } };
}

interface ZerionTxPage {
  data?: ZerionTx[];
  links?: { next?: string | null };
}

async function get<T>(url: string): Promise<T> {
  if (!config.zerionApiKey) throw new Error('ZERION_API_KEY is not set');
  const auth = Buffer.from(`${config.zerionApiKey}:`).toString('base64');
  const res = await fetch(url, {
    headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
    signal: AbortSignal.timeout(config.zerionTimeoutMs),
  });
  if (!res.ok) throw new Error(`zerion transactions answered ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Zerion's chain ids, in the spelling the rest of this system uses.
 *
 * `Position.network` is documented as "the network as the source names it: eth,
 * arb, base, op, sol, tron, btc" — the short form DeBank produces, and the form
 * the UI kit's network badges are keyed by. Zerion says `arbitrum`,
 * `optimism`, `polygon`, so a transfer stored raw shows up beside a position on
 * the same chain under a different name, and the badge for it renders nothing.
 *
 * Only the ones that differ are listed. Anything not here is passed through,
 * which is right for the long tail — `base`, `linea`, `blast`, `sonic` and
 * `celo` already agree, and a chain the badge does not know renders as its own
 * id rather than as nothing.
 */
const NETWORK_ID: Record<string, string> = {
  ethereum: 'eth',
  arbitrum: 'arb',
  optimism: 'op',
  polygon: 'matic',
  'binance-smart-chain': 'bsc',
  avalanche: 'avax',
  'zksync-era': 'era',
  mantle: 'mnt',
  fantom: 'ftm',
  hyperevm: 'hyper',
  unichain: 'uni',
  scroll: 'scrl',
  solana: 'sol',
};

const networkOf = (id: string | null): string | null => (id ? (NETWORK_ID[id] ?? id) : null);

/** EVM addresses are stored lowercased; base58 chains keep the case they came in */
const normalize = (value: string | null | undefined): string | null => {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : raw;
};

/**
 * The asset's own address on the chain this happened on. Zerion lists every
 * chain a fungible exists on, so the one that matters is the one matching the
 * transaction's chain; a native coin has no implementation address at all.
 */
function assetIdOf(transfer: ZerionTxTransfer, chainId: string | null): string | null {
  const list = transfer.fungible_info?.implementations ?? [];
  const here = list.find((i) => i.chain_id === chainId) ?? list[0];
  return here?.address ?? null;
}

function toTransfers(tx: ZerionTx, self: string): RawTransfer[] {
  const a = tx.attributes ?? {};
  // A failed transaction moved nothing but still appears in the list. Counting
  // one would net a withdrawal off a balance that never fell.
  if (a.status && a.status !== 'confirmed') return [];
  const hash = a.hash ?? '';
  const minedAt = a.mined_at ? new Date(a.mined_at) : null;
  if (!hash || !minedAt || Number.isNaN(minedAt.getTime())) return [];

  const chainId = tx.relationships?.chain?.data?.id ?? null;
  const operation = a.operation_type ?? 'execute';
  const out: RawTransfer[] = [];

  (a.transfers ?? []).forEach((transfer, idx) => {
    // `self` is a transfer between two addresses of the same owner as Zerion
    // sees it; it moved nothing and has no direction worth storing
    if (transfer.direction !== 'in' && transfer.direction !== 'out') return;
    const amount = transfer.quantity?.float;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) return;

    // The other side is whichever end is not us. Zerion fills both, and for a
    // contract interaction the counterparty is the contract — which is exactly
    // what the classifier wants to compare against the portfolio's addresses.
    const from = normalize(transfer.sender ?? a.sent_from);
    const to = normalize(transfer.recipient ?? a.sent_to);
    const mine = self.toLowerCase();
    const counterparty = transfer.direction === 'in' ? from : to;

    out.push({
      txHash: hash,
      idx,
      minedAt,
      direction: transfer.direction,
      counterparty: counterparty && counterparty.toLowerCase() === mine ? null : counterparty,
      network: networkOf(chainId),
      operation,
      symbol: transfer.fungible_info?.symbol || transfer.fungible_info?.name || '?',
      assetId: assetIdOf(transfer, chainId),
      amount: Math.abs(amount),
      priceUsd: transfer.price ?? null,
      valueUsd: transfer.value ?? null,
    });
  });

  return out;
}

export const zerionTransfers: FlowSource = {
  name: 'zerion',

  async read(address, { until, cursor, pageSize }): Promise<TransferPage> {
    // A cursor is a whole URL Zerion built, filters and all — reusing it is the
    // only supported way to page, and rebuilding the query beside it would be a
    // second source of truth for the same request.
    const url =
      cursor ??
      `${API}/wallets/${address}/transactions/?` +
        [
          'currency=usd',
          'filter[asset_types]=fungible',
          'filter[trash]=only_non_trash',
          `page[size]=${Math.min(Math.max(pageSize, 1), 100)}`,
          // The floor of what is worth asking for at all. On an incremental read
          // this is where we already have history from; on a backfill it is how
          // deep the backfill goes.
          ...(until ? [`filter[min_mined_at]=${until.getTime()}`] : []),
        ].join('&');

    const page = await get<ZerionTxPage>(url);
    const rows = page.data ?? [];
    const transfers = rows.flatMap((tx) => toTransfers(tx, address));
    logger.debug(`${address}: ${rows.length} transactions, ${transfers.length} transfers`);
    return { transfers, next: page.links?.next ?? null };
  },
};
