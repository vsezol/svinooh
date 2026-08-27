import type { AlertEvent, AlertItem } from '@svinooh/shared';

const CHAIN_NAME: Record<string, string> = {
  BTC: 'Bitcoin wallet',
  EVM: 'EVM wallet',
  SOL: 'Solana wallet',
  TRON: 'TRON wallet',
};

/**
 * A number as somebody would read it, not as it is stored. Trailing zeroes go:
 * a threshold somebody typed as "12" should not come back as "12.00%".
 */
const num = (value: number): string => {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

/**
 * One line per thing that happened.
 *
 * Every line says what changed and what the reading was, because a warning
 * without a number is a warning you have to go and check. The ones that are
 * getting worse lead with a mark that says so at a glance; recoveries are
 * deliberately quieter — nobody needs to be alarmed by good news.
 */
function line(item: AlertItem): string {
  const entered = item.direction === 'entered';
  switch (item.kind) {
    case 'range':
      return entered
        ? `⚠️ ${item.position} — out of range, earning nothing`
        : `✅ ${item.position} — back in range`;
    case 'health':
      return entered
        ? `🚨 ${item.position} — health factor ${num(item.value ?? 0)}, under your ${num(item.threshold ?? 0)}`
        : `✅ ${item.position} — health factor back to ${num(item.value ?? 0)}`;
    case 'borrow':
      return entered
        ? `⚠️ ${item.position} — borrowing at ${num(item.value ?? 0)}%, over your ${num(item.threshold ?? 0)}%`
        : `✅ ${item.position} — borrow rate back to ${num(item.value ?? 0)}%`;
  }
}

/**
 * The whole message.
 *
 * It names the wallet the way its owner named it, and falls back to the network
 * rather than to the address: this only ever reaches the one person who owns
 * the wallet, and a label they wrote is what they will recognise.
 *
 * The heading counts, because three alerts arriving as one message should not
 * look like one alert with a long body.
 */
export function formatAlert(event: AlertEvent, webUrl: string): { text: string; markup: unknown } {
  const wallet = event.walletLabel ?? CHAIN_NAME[event.chain] ?? event.chain;
  const worsened = event.items.filter((i) => i.direction === 'entered').length;
  const heading = worsened
    ? `${wallet} — ${worsened} ${worsened === 1 ? 'alert' : 'alerts'}`
    : `${wallet} — all clear`;

  const text = [heading, '', ...event.items.map(line)].join('\n');
  const url = `${webUrl}/p/${event.portfolioSlug}`;
  return { text, markup: { inline_keyboard: [[{ text: 'Open portfolio →', url }]] } };
}
