import type { AlertEvent, AlertItem, PositionBand } from '@svinooh/shared';

const CHAIN_NAME: Record<string, string> = {
  BTC: 'Bitcoin wallet',
  EVM: 'EVM wallet',
  SOL: 'Solana wallet',
  TRON: 'TRON wallet',
};

/**
 * Telegram parses the message as HTML, so anything that came from outside has
 * to stop being markup first. The wallet label is the one that matters: it is
 * text its owner wrote, and a label with a `<` in it would otherwise take the
 * rest of the message down with it.
 */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A number as somebody would read it, not as it is stored. Trailing zeroes go:
 * a threshold somebody typed as "12" should not come back as "12.00%".
 */
const num = (value: number): string => {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

/**
 * A price, at the precision that price deserves. Two decimals reads right for
 * anything worth a dollar or more and is what the bounds of a BTC or ETH pool
 * look like; below that it would round a real number to 0.00, so a small price
 * keeps four significant digits instead.
 */
function price(value: number): string {
  if (!Number.isFinite(value)) return '?';
  const abs = Math.abs(value);
  if (abs >= 1) return value.toFixed(2);
  if (abs === 0) return '0';
  return value.toPrecision(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Where the price stands in the band, as a fraction of it: 0 is the floor, 1 is
 * the ceiling, and anything outside those is how far past the edge it has gone.
 *
 * This is the number that turns "out of range" into something actionable —
 * +1.01 is a position that has just tipped over the top and may well come back,
 * +1.40 is one that is not coming back on its own. The sign is written out when
 * the price is above the band, because "+1.01" and "0.99" being a hair apart in
 * price and a world apart in meaning is exactly what has to be visible.
 */
function standing(band: PositionBand): string | null {
  const width = band.upper - band.lower;
  if (!Number.isFinite(width) || width <= 0) return null;
  const at = (band.current - band.lower) / width;
  if (!Number.isFinite(at)) return null;
  return at >= 1 ? `+${at.toFixed(2)}` : at.toFixed(2);
}

/** The mark in front of a line: what happened, before you have read what it was */
function mark(item: AlertItem): string {
  if (item.direction === 'recovered') return '✅';
  return item.kind === 'health' ? '🚨' : item.kind === 'borrow' ? '⚠️' : '🔴';
}

/** "cbBTC/USDC 0.04% (Solana)" where the protocol answered, the bare name where it did not */
function title(item: AlertItem): string {
  if (!item.band) return esc(item.position);
  const fee = item.band.feePct === null ? '' : ` ${num(item.band.feePct)}%`;
  return `${esc(item.position)}${fee} (${esc(item.band.chainLabel)})`;
}

/** What changed, and what the reading was — never one without the other */
function status(item: AlertItem): string {
  const value = item.value ?? 0;
  const threshold = item.threshold ?? 0;
  switch (item.kind) {
    case 'range': {
      const at = item.band ? standing(item.band) : null;
      const state = item.direction === 'entered' ? 'OUT OF RANGE' : 'IN RANGE';
      const was = item.direction === 'entered' ? 'was in range' : 'was out of range';
      return `Status: ${state}${at ? ` ${at}` : ''} (${was})`;
    }
    case 'health':
      return item.direction === 'entered'
        ? `Status: HEALTH FACTOR ${num(value)}, under your ${num(threshold)}`
        : `Status: HEALTH FACTOR ${num(value)}, back above your ${num(threshold)}`;
    case 'borrow':
      return item.direction === 'entered'
        ? `Status: BORROW APY ${num(value)}%, over your ${num(threshold)}%`
        : `Status: BORROW APY ${num(value)}%, back under your ${num(threshold)}%`;
  }
}

/**
 * One position: what happened to it, what the reading was, and where its band
 * is. Three lines rather than one, because a warning you have to go and look up
 * is a warning that costs more than it saves.
 */
function lines(item: AlertItem): string[] {
  const out = [`${mark(item)} ${title(item)}:`, status(item)];
  if (item.kind === 'range' && item.band) {
    const { lower, upper, priceLabel } = item.band;
    out.push(`Range: ${price(lower)} — ${price(upper)} ${esc(priceLabel)}`);
  }
  return out;
}

/**
 * The whole message.
 *
 * It opens with the wallet: the owner's own label, then the address in
 * monospace so it can be tapped and copied. That is safe here and nowhere else
 * — this only ever reaches the one person who owns the wallet, in a chat with
 * nobody else in it. A wallet with no label falls back to its network rather
 * than to its address, which is already on the next line.
 *
 * Then the positions, grouped under the protocol they belong to, in the order
 * they arrived. Grouping is what keeps a wallet with four Meteora pools from
 * reading as four unrelated warnings, and it is why the protocol is carried
 * separately from the position's own name instead of being repeated on every
 * line.
 */
export function formatAlert(event: AlertEvent, webUrl: string): { text: string; markup: unknown } {
  const wallet = event.walletLabel ?? CHAIN_NAME[event.chain] ?? event.chain;

  const groups = new Map<string, AlertItem[]>();
  for (const item of event.items) {
    const key = item.platform || 'Positions';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const body: string[] = [];
  for (const [platform, items] of groups) {
    body.push('', `<b>${esc(platform.toUpperCase())}</b>`, '');
    for (const item of items) body.push(...lines(item));
  }

  const text = [`<b>${esc(wallet)}</b>`, `<code>${esc(event.walletAddress)}</code>`, ...body].join('\n');
  const url = `${webUrl}/p/${event.portfolioSlug}`;
  return { text, markup: { inline_keyboard: [[{ text: 'Open portfolio →', url }]] } };
}
