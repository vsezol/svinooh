/**
 * Прогон сканеров по контрольным кошелькам из MICROSERVICE_PROMPT.md.
 * Цены плавают — важен порядок величин:
 *
 *   BTC  ~$1.4k
 *   SOL  ~$13.8k (defi ~$12.2k + gmtrade ~$1.5k)
 *   TRON ~$3.7k  — если ~$3, потерян стейк (грабля №2)
 *   EVM  ~$27k   — если $0, гонка headless Chrome (грабля №3)
 *
 * Запуск: npm run verify:scanners [-- btc|sol|tron|evm]
 * EVM пробует HTTP (debank реверс-подпись), при осечке — Chrome; какой путь
 * сработал, видно в лог-строках EvmScanner.
 */
import { scanAddress, detectChain } from '../src/scanners';
import { closeBrowser } from '../src/scanners/browser';

const CONTROL: Array<{ address: string; hint: string }> = [
  { address: 'bc1qlggpznpwv0e5nuc5lmgdcugd64lrjkspcgkyam', hint: '~$1.4k' },
  {
    address: 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL',
    hint: '~$13.8k; gmtrade ~$1.5k (если ~$1.7k — считаем TVL/supply, грабля №1)',
  },
  {
    address: 'TEF8gN62a3v8cH956eGe2NNfPoZQsrZfi3',
    hint: '~$3.7k (если ~$3 — потерян стейк TRX, грабля №2)',
  },
  {
    address: '0xe2dd4d99f7fc9d0acbc73f52c4dc86a2dafdb53e',
    hint: '~$27k (если $0 — гонка headless Chrome, грабля №3)',
  },
];

async function main() {
  const only = process.argv[2]?.toUpperCase();
  let total = 0;

  for (const { address, hint } of CONTROL) {
    const chain = detectChain(address);
    if (!chain) {
      console.log(`✗ ${address}: сеть не распознана`);
      continue;
    }
    if (only && chain !== only) continue;

    try {
      const startedAt = Date.now();
      const result = await scanAddress(chain, address);
      total += result.totalUsd;
      const extras = result.breakdown ? ` ${JSON.stringify(result.breakdown)}` : '';
      console.log(
        `${chain.padEnd(4)} ${address}  $${result.totalUsd.toFixed(2)}  (${((Date.now() - startedAt) / 1000).toFixed(1)}с, позиций: ${result.positions.length})${extras}`,
      );
      for (const p of [...result.positions].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 8)) {
        console.log(`       ${p.symbol.slice(0, 30).padEnd(30)} $${p.valueUsd.toFixed(2)}`);
      }
      if (result.unpriced?.length) console.log(`       без цены: ${result.unpriced.join(', ')}`);
      console.log(`       ожидание: ${hint}\n`);
    } catch (error) {
      console.log(`✗ ${chain} ${address}: ${(error as Error).message}\n`);
    }
  }

  console.log(`Total: $${total.toFixed(2)}`);
  await closeBrowser();
}

void main();
