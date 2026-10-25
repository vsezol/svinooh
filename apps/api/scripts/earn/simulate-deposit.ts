const EARN = (process.env.EARN_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const OWNER = process.env.DEPOSIT_OWNER || 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';
const TOKEN = process.env.DEPOSIT_TOKEN || '';
const AMOUNT = process.env.DEPOSIT_AMOUNT || '1';

interface Pool {
  id: string;
  name: string;
  kind: string;
  token: { symbol: string; decimals: number | null };
}

interface Built {
  transaction: string;
  instructions: number;
}

async function poolOfKind(kind: 'vault' | 'reserve'): Promise<Pool | null> {
  const narrowed = TOKEN ? `&token=${encodeURIComponent(TOKEN)}` : '';
  const listed = (await fetch(
    `${EARN}/v1/lend/pools?sort=-tvl_usd&limit=60&kind=${kind}${narrowed}`,
  ).then((answered) => answered.json())) as { data: Pool[] };
  return listed.data[0] ?? null;
}

async function build(pool: Pool): Promise<Built> {
  const answered = await fetch(`${EARN}/v1/lend/pools/${pool.id}/deposit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: AMOUNT, owner: OWNER }),
  });
  const body = (await answered.json()) as { data?: Built; detail?: string };
  if (!answered.ok || !body.data) {
    throw new Error(`${answered.status}: ${body.detail ?? 'no transaction came back'}`);
  }
  return body.data;
}

function carriesBaseUnits(transaction: string, pool: Pool): boolean {
  const decimals = pool.token.decimals ?? 0;
  const [whole, fraction = ''] = AMOUNT.split('.');
  const base = BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
  const needle = Buffer.alloc(8);
  needle.writeBigUInt64LE(base);
  return Buffer.from(transaction, 'base64').includes(needle);
}

async function simulate(transaction: string) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: [transaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }],
  };
  const answer = (await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((answered) => answered.json())) as { result?: { value?: any } };
  return answer.result?.value ?? answer;
}

async function main() {
  console.log(`earn: ${EARN}`);
  for (const kind of ['vault', 'reserve'] as const) {
    const pool = await poolOfKind(kind);
    if (!pool) {
      console.log(`${kind}: no pool in the catalog`);
      continue;
    }
    console.log(`\n=== ${kind}: ${pool.name} (${pool.id})`);
    const built = await build(pool);
    const bytes = Buffer.from(built.transaction, 'base64').length;
    const fits = bytes <= 1232 ? 'fits a packet' : 'TOO BIG for one packet';
    console.log(`   built: ${built.instructions} instructions, ${bytes} bytes — ${fits}`);
    console.log(`   amount in base units reaches the program: ${carriesBaseUnits(built.transaction, pool)}`);
    const outcome = await simulate(built.transaction);
    console.log(`   err: ${JSON.stringify(outcome.err)}`);
    console.log(`   units: ${outcome.unitsConsumed}`);
    if (outcome.err) {
      console.log(`   (simulated as ${OWNER.slice(0, 8)}… — a wallet with no ${pool.token.symbol}`);
      console.log(`    fails here on funds, which says nothing about the instructions)`);
    }
    for (const line of (outcome.logs ?? []).slice(-6)) console.log(`   | ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
