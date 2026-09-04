import type {
  AlertEvent,
  AlertItem,
  BillingNotice,
  PositionBand,
  SlowedNotice,
  TronResources,
} from '@svinooh/shared';

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

/**
 * The mark in front of a line: which of the two things this is, before you have
 * read what it was. Everything wrong is one mark and everything fixed is the
 * other — a siren for a health factor and a warning sign for a borrow rate made
 * a message of four lines look like four different kinds of trouble, when the
 * only distinction that matters at a glance is whether it needs you.
 */
function mark(item: AlertItem): string {
  // Tron's two are not trouble — they say something became possible, and a red
  // dot on "you can put your resources to work" reads as a problem
  if (item.kind === 'reclaim') return '🔓';
  if (item.kind === 'delegate') return '🟢';
  return item.direction === 'recovered' ? '✅' : '🔴';
}

/** "cbBTC/USDC 0.04% (Solana)" where the protocol answered, the bare name where it did not */
function title(item: AlertItem): string {
  if (!item.band) return esc(item.position);
  const fee = item.band.feePct === null ? '' : ` ${num(item.band.feePct)}%`;
  return `${esc(item.position)}${fee} (${esc(item.band.chainLabel)})`;
}

/**
 * A reading, picked out, and which side of the line it fell on: `2.8 << 4` is a
 * health factor under a threshold of 4, `13.9% >> 12%` a borrow rate over one.
 *
 * Which side it is on is the whole message, so it is a comparator and not a
 * sentence — and it is read off the two numbers rather than off what the
 * collector decided, so it cannot end up disagreeing with them.
 */
function against(value: number, threshold: number, unit = ''): string {
  const sign = value >= threshold ? '&gt;&gt;' : '&lt;&lt;';
  // Whose line it is, said once and plainly: the number on the right is not the
  // market's opinion, it is what this reader asked to be told about
  return `<b>${num(value)}${unit}</b> ${sign} ${num(threshold)}${unit} (your settings)`;
}

/** What changed, and what the reading was — never one without the other */
function status(item: AlertItem): string {
  const value = item.value ?? 0;
  const threshold = item.threshold ?? 0;
  switch (item.kind) {
    case 'range': {
      const at = item.band ? standing(item.band) : null;
      const state = item.direction === 'recovered' ? 'IN RANGE' : 'OUT OF RANGE';
      const was = item.direction === 'recovered' ? 'was out of range' : 'was in range';
      return `Status: ${state}${at ? ` ${at}` : ''} (${was})`;
    }
    case 'health':
      return `Health factor: ${against(value, threshold)}`;
    case 'borrow':
      return `Borrow APY: ${against(value, threshold, '%')}`;
    case 'reclaim':
      return 'Status: a delegation has unlocked — you can take it back';
    case 'delegate':
      return 'Status: resources are idle and nothing is delegated';
  }
}

/** "12,480" — resource counts are big and unitless, and only the magnitude reads */
function count(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '?';
}

/** TRX, to the cent */
function trx(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString('en-US') : '?';
}

/**
 * What the wallet has to spend and what it has lent out — the port of the
 * monolith's `formatTronResources`.
 *
 * Free before total, because what is left is the number anybody acts on. The
 * reclaim line is the reason most of these messages get read at all, so it says
 * either a date and how far off it is, or that the wait is over.
 */
function tronLines(tron: TronResources, now: number): string[] {
  const out = [
    `⚡ Energy: ${count(tron.energyFree)} / ${count(tron.energyTotal)} free`,
    `📶 Bandwidth: ${count(tron.bandwidthFree)} / ${count(tron.bandwidthTotal)} free`,
  ];

  if (!tron.hasDelegation) {
    out.push('Delegated out: none');
    return out;
  }

  const parts: string[] = [];
  if (tron.delegatedEnergy > 0) {
    parts.push(`${count(tron.delegatedEnergy)} energy (${trx(tron.delegatedEnergyTrx)} TRX)`);
  }
  if (tron.delegatedBandwidth > 0) {
    parts.push(`${count(tron.delegatedBandwidth)} bandwidth (${trx(tron.delegatedBandwidthTrx)} TRX)`);
  }
  out.push(`Delegated out: ${parts.join(', ') || 'yes'}`);

  // expireAt of 0 is a delegation made WITHOUT a lock, not one that expired in
  // 1970 — both mean it can be taken back now
  let nextAt: number | null = null;
  let now_ = false;
  for (const d of tron.delegations) {
    if (!d.expireAt || d.expireAt <= now) now_ = true;
    else if (nextAt === null || d.expireAt < nextAt) nextAt = d.expireAt;
  }
  if (now_) out.push('Reclaimable: now ✅');
  else if (nextAt !== null) {
    const days = Math.ceil((nextAt - now) / 86_400_000);
    const date = new Date(nextAt).toISOString().slice(0, 10);
    out.push(`Reclaimable: ${date} (in ${days} day${days === 1 ? '' : 's'})`);
  }
  return out;
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
  // For Tron the resources ARE the message: "you can reclaim" without saying
  // how much of what is a notification that sends you somewhere else to find out
  if (item.tron) out.push(...tronLines(item.tron, Date.now()));
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

/** "3 days" reads better than "4320 minutes" */
function forHowLong(minutes: number): string {
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Your portfolio has gone quiet, so we are checking it less often.
 *
 * No warning mark and no alarm: nothing is wrong, and the thing being described
 * is a saving rather than a problem. What it does have to be is unambiguous
 * about the way back, because the action that restores the rate is the same
 * action that stops this message coming again.
 */
export function formatSlowedNotice(
  notice: SlowedNotice,
  webUrl: string,
): { text: string; markup: unknown } {
  const name = notice.portfolioName ?? notice.portfolioSlug;
  const url = `${webUrl}/p/${notice.portfolioSlug}`;
  const text = [
    `<b>${esc(name)}</b> — checking less often`,
    '',
    `Nobody has opened this portfolio in ${forHowLong(notice.quietForMin)}, so its wallets ` +
      `are now read every ${notice.nowEveryMin} minutes instead of every ${notice.wasEveryMin}.`,
    '',
    'Open it and the usual rate comes straight back.',
  ].join('\n');
  return { text, markup: { inline_keyboard: [[{ text: 'Open portfolio →', url }]] } };
}

/** "2026-10-04" — a renewal date is a date, not a moment */
const day = (iso: string): string => iso.slice(0, 10);

/**
 * Everything money says, in one voice: plain about what happened, concrete
 * about the way out, and priced with the numbers that were true when the
 * message was decided — the notice carries them so this view never guesses.
 *
 * The pitch line leads with the deal because that is the marketing ask, but
 * the messages never bury what happened: the trial one opens with the alert
 * that was NOT delivered, which is the honest half of the offer.
 */
export function formatBillingNotice(
  notice: BillingNotice,
  webUrl: string,
): { text: string; markup: unknown } {
  const proUrl = `${webUrl}/pro`;
  const deal = `$${notice.priceUsd}/month instead of $${notice.wasPriceUsd}`;
  switch (notice.kind) {
    case 'trial-ended': {
      const text = [
        '<b>A wallet just tripped an alert — and your free alerts are used up</b>',
        '',
        `The free plan includes ${notice.freeAlerts ?? 'a few'} alert messages, and this account has spent them. ` +
          'Until Svinooh.Pro is on, alerts are decided and remembered but not delivered.',
        '',
        `Svinooh.Pro keeps them coming — with unlimited portfolios, wallets and full history. ` +
          `${deal}, and the first month is $${notice.firstMonthUsd}.`,
      ].join('\n');
      return { text, markup: { inline_keyboard: [[{ text: 'Get Svinooh.Pro →', url: proUrl }]] } };
    }
    case 'expiring': {
      const left = notice.daysLeft ?? 1;
      const text = [
        `<b>Svinooh.Pro ends in ${left} day${left === 1 ? '' : 's'}</b>`,
        '',
        `Paid until ${notice.paidUntil ? day(notice.paidUntil) : 'soon'}. Renew for $${notice.priceUsd} and nothing changes; ` +
          'let it lapse and the free limits come back.',
      ].join('\n');
      return { text, markup: { inline_keyboard: [[{ text: 'Renew →', url: proUrl }]] } };
    }
    case 'expired': {
      const limits = notice.limits;
      const back = limits
        ? `${limits.freePortfolios} portfolio${limits.freePortfolios === 1 ? '' : 's'}, ` +
          `${limits.freeWalletsPerPortfolio} wallets each, ${limits.freeHistoryDays} days of history, ` +
          'and no alerts past the trial'
        : 'the free limits';
      const text = [
        '<b>Svinooh.Pro has ended</b>',
        '',
        `The free plan is back: ${back}. Everything you built is exactly where you left it.`,
        '',
        `Renew for ${deal}.`,
      ].join('\n');
      return { text, markup: { inline_keyboard: [[{ text: 'Renew →', url: proUrl }]] } };
    }
    case 'paid': {
      const text = [
        '<b>Svinooh.Pro is active</b>',
        '',
        `Paid until ${notice.paidUntil ? day(notice.paidUntil) : 'next month'}. Unlimited portfolios and wallets, ` +
          'full history, alerts without a counter. Thank you.',
      ].join('\n');
      return { text, markup: { inline_keyboard: [[{ text: 'Open svinooh →', url: webUrl }]] } };
    }
  }
}
