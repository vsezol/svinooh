/**
 * Run the scanners against the control wallets from MICROSERVICE_PROMPT.md.
 * Prices fluctuate — what matters is the order of magnitude:
 *
 *   BTC  ~$1.4k
 *   SOL  ~$13.8k (defi ~$12.2k + gmtrade ~$1.5k)
 *   TRON ~$3.7k  — if ~$3, the stake is lost (pitfall #2)
 *   EVM  ~$27k   — if $0, headless Chrome race condition (pitfall #3)
 *
 * Run: npm run verify:scanners [-- btc|sol|tron|evm]
 * EVM tries HTTP (debank reverse signature), and on failure — Chrome; which path
 * was taken is visible in the EvmScanner log lines.
 */
import type { Chain } from '@svinooh/shared';
import { scanAddress } from '../src/scanners';
import { closeBrowser } from '../src/scanners/browser';

const CONTROL: Array<{ chain: Chain; address: string; hint: string }> = [
  { chain: 'BTC', address: 'bc1qlggpznpwv0e5nuc5lmgdcugd64lrjkspcgkyam', hint: '~$1.4k' },
  {
    chain: 'SOL',
    address: 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL',
    hint: '~$13.8k; gmtrade ~$1.5k (if ~$1.7k — we are counting TVL/supply, pitfall #1)',
  },
  {
    chain: 'TRON',
    address: 'TEF8gN62a3v8cH956eGe2NNfPoZQsrZfi3',
    hint: '~$3.7k (if ~$3 — the TRX stake is lost, pitfall #2)',
  },
  {
    chain: 'EVM',
    address: '0xe2dd4d99f7fc9d0acbc73f52c4dc86a2dafdb53e',
    hint: '~$27k (if $0 — headless Chrome race condition, pitfall #3)',
  },
];

async function main() {
  const only = process.argv[2]?.toUpperCase();
  let total = 0;

  for (const { chain, address, hint } of CONTROL) {
    if (only && chain !== only) continue;

    try {
      const startedAt = Date.now();
      const result = await scanAddress(chain, address);
      total += result.totalUsd;
      const extras = result.breakdown ? ` ${JSON.stringify(result.breakdown)}` : '';
      console.log(
        `${chain.padEnd(4)} ${address}  $${result.totalUsd.toFixed(2)}  (${((Date.now() - startedAt) / 1000).toFixed(1)}s, positions: ${result.positions.length})${extras}`,
      );
      for (const p of [...result.positions].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 10)) {
        const kind = [p.name, p.note].filter(Boolean).join(' · ');
        const extra = [
          p.apy != null ? `${(p.apy * 100).toFixed(1)}% APY` : null,
          p.healthRate != null ? `HF ${p.healthRate.toFixed(2)}` : null,
          p.range ? (p.range === 'in' ? 'IN RANGE' : 'OUT OF RANGE') : null,
        ]
          .filter(Boolean)
          .join(' ');
        console.log(
          `       ${p.symbol.slice(0, 26).padEnd(26)} $${p.valueUsd.toFixed(2).padStart(11)}  ${kind}${extra ? '  ' + extra : ''}`,
        );
        for (const leg of p.tokens || []) {
          const qty = leg.amount != null ? `${leg.amount.toPrecision(6)} × $${(leg.priceUsd ?? 0).toPrecision(6)}` : '—';
          console.log(
            `         └ ${leg.role.padEnd(6)} ${leg.symbol.slice(0, 20).padEnd(20)} $${leg.valueUsd.toFixed(2).padStart(11)}  ${qty}`,
          );
        }
      }
      if (result.unpriced?.length) console.log(`       unpriced: ${result.unpriced.join(', ')}`);
      console.log(`       expected: ${hint}\n`);
    } catch (error) {
      console.log(`✗ ${chain} ${address}: ${(error as Error).message}\n`);
    }
  }

  console.log(`Total: $${total.toFixed(2)}`);
  await closeBrowser();
}

void main();
