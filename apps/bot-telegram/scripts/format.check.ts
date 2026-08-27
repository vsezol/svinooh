/**
 * What the messages actually look like. Run with
 * `npm run -w apps/bot-telegram check`.
 */
import { formatAlert } from '../src/format';
import type { AlertEvent } from '@svinooh/shared';

const base: Omit<AlertEvent, 'items'> = {
  telegramId: '1',
  portfolioSlug: 'vcx1uzcvlk',
  walletLabel: null,
  walletAddress: '0x3e87…d90c',
  chain: 'EVM',
};

const show = (title: string, event: AlertEvent) => {
  console.log(`\n--- ${title} ---`);
  console.log(formatAlert(event, 'https://svinooh.com').text);
};

show('вышла из диапазона', {
  ...base,
  walletLabel: 'Main Ledger',
  items: [{ kind: 'range', direction: 'entered', position: 'cbBTC/USDC', value: null, threshold: null }],
});

show('health factor пробит', {
  ...base,
  items: [{ kind: 'health', direction: 'entered', position: 'Venus · Lending', value: 1.04, threshold: 1.1 }],
});

show('всё сразу', {
  ...base,
  walletLabel: 'Main Ledger',
  items: [
    { kind: 'health', direction: 'entered', position: 'Venus · Lending', value: 1.04, threshold: 1.1 },
    { kind: 'borrow', direction: 'entered', position: 'Aave V3 Arbitrum', value: 18.4, threshold: 12 },
    { kind: 'range', direction: 'recovered', position: 'WETH/USDT', value: null, threshold: null },
  ],
});

show('только хорошие новости — без тревоги в заголовке', {
  ...base,
  items: [{ kind: 'health', direction: 'recovered', position: 'Venus · Lending', value: 1.62, threshold: 1.1 }],
});

show('без метки кошелька — падаем на сеть, не на адрес', {
  ...base,
  chain: 'SOL',
  items: [{ kind: 'range', direction: 'entered', position: 'SOL/USDC', value: null, threshold: null }],
});
