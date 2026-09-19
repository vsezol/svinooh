import { buildDeposit } from '../src/lib/deposit/kamino';
import type { DepositRequest } from '../src/lib/deposit/types';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const OWNER = process.env.DEPOSIT_OWNER || 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';
const EARN = process.env.EARN_API_URL || '';

async function poolFromCatalog(kind: 'vault' | 'reserve'): Promise<DepositRequest | null> {
  if (!EARN) return null;
  const list = await fetch(`${EARN}/v1/lend/pools?sort=-tvl_usd&limit=40&token=USDC`).then((r) => r.json());
  const summary = (list.data as Array<Record<string, string>>).find((p) => p.kind === kind);
  if (!summary) return null;
  const full = await fetch(`${EARN}/v1/lend/pools/${summary.id}`).then((r) => r.json());
  const d = full.data.deposit;
  return {
    poolId: full.data.id,
    pool: full.data.name,
    protocol: full.data.protocol,
    poolKind: full.data.kind,
    network: full.data.network,
    token: full.data.token.symbol,
    amount: '1',
    accounts: {
      programId: d.program_id,
      address: d.address,
      tokenMint: full.data.token.mint,
      tokenDecimals: full.data.token.decimals,
      sharesMint: d.shares_mint,
      sharesDecimals: d.shares_decimals,
      tokenProgram: d.token_program,
      lendingMarket: d.lending_market,
    },
  };
}

function carriesBaseUnits(transaction: string, request: DepositRequest): boolean {
  const decimals = request.accounts.tokenDecimals ?? 0;
  const base = BigInt(request.amount) * 10n ** BigInt(decimals);
  const needle = Buffer.alloc(8);
  needle.writeBigUInt64LE(base);
  return Buffer.from(transaction, 'base64').includes(needle);
}

async function simulate(built: { transaction: string }) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: [built.transaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }],
  };
  const answer = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  return answer.result?.value ?? answer;
}

async function main() {
  for (const kind of ['vault', 'reserve'] as const) {
    const request = await poolFromCatalog(kind);
    if (!request) {
      console.log(`${kind}: no pool (set EARN_API_URL)`);
      continue;
    }
    console.log(`\n=== ${kind}: ${request.pool} (${request.poolId})`);
    const built = await buildDeposit(request, OWNER, RPC);
    console.log(`   built: ${built.instructions} instructions, ${built.transaction.length} b64 chars`);
    console.log(`   amount in base units reaches the program: ${carriesBaseUnits(built.transaction, request)}`);
    const outcome = await simulate(built);
    console.log(`   err: ${JSON.stringify(outcome.err)}`);
    console.log(`   units: ${outcome.unitsConsumed}`);
    for (const line of (outcome.logs ?? []).slice(-6)) console.log(`   | ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
