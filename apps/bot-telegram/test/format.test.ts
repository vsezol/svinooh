import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { AlertEvent, AlertItem } from '@svinooh/shared';
import { formatAlert, rebalanceButtons } from '../src/format';

const WEB = 'https://svinooh.com';

const band = {
  pair: 'SOL/USDC',
  feePct: 0.05,
  chainLabel: 'Solana',
  lower: 75.05,
  upper: 110.42,
  current: 117.25,
  priceLabel: 'USDC per SOL',
};

const out: AlertItem = {
  kind: 'range',
  direction: 'entered',
  platform: 'Meteora',
  position: 'SOL/USDC',
  value: null,
  threshold: null,
  band,
  loan: null,
};

const event = (...items: AlertItem[]): AlertEvent => ({
  telegramId: '1',
  portfolioSlug: 'vivid-cozy-stork',
  walletLabel: null,
  walletAddress: 'HAa5iXk3SpygjwNeUm3vSoxd5oupHqMGg1f9ooVdr5TV',
  chain: 'SOL',
  items,
});

const keyboard = (made: { markup: unknown }) =>
  (made.markup as { inline_keyboard: Array<Array<{ text: string; url: string }>> }).inline_keyboard;

describe('APositionThatLeftItsRange', () => {
  test('comes with a second button that asks the assistant to rebalance it', () => {
    const rows = keyboard(formatAlert(event(out), WEB));
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0].text, 'Open portfolio →');
    assert.equal(rows[1][0].text, 'Rebalance with AI →');
  });

  test('the button opens the portfolio\'s assistant with the question in the link', () => {
    const [[button]] = rebalanceButtons(event(out), WEB);
    const link = new URL(button.url);
    assert.equal(link.pathname, '/p/vivid-cozy-stork');
    assert.equal(link.searchParams.get('tab'), 'agent');
    assert.equal(
      link.searchParams.get('q'),
      'Rebalance my Meteora SOL/USDC position that went out of range (75.05 - 110.42 USDC per SOL): ' +
        'close it and place it again around the current price, keeping its width.',
    );
  });

  test('the link never carries an address', () => {
    const [[button]] = rebalanceButtons(event(out), WEB);
    assert.ok(!button.url.includes('HAa5iX'));
  });

  test('coming back into range, or a protocol the assistant cannot rebalance, gets no button', () => {
    assert.deepEqual(rebalanceButtons(event({ ...out, direction: 'recovered' }), WEB), []);
    assert.deepEqual(rebalanceButtons(event({ ...out, platform: 'Orca' }), WEB), []);
    assert.deepEqual(rebalanceButtons(event({ ...out, band: null }), WEB), []);
  });

  test('two positions out at once are each named, and a flood is capped', () => {
    const other = { ...out, band: { ...band, pair: 'JUP/SOL' }, position: 'JUP/SOL' };
    const rows = rebalanceButtons(event(out, other, out, out), WEB);
    assert.equal(rows.length, 3);
    assert.equal(rows[1][0].text, 'Rebalance JUP/SOL with AI →');
  });
});
