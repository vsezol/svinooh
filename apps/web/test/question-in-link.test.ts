import { strict as assert } from 'node:assert';
import { afterEach, describe, test } from 'node:test';
import { forgetQuestionInLink, questionInLink } from '../src/lib/handoff';

const QUESTION =
  'Rebalance my Meteora SOL/USDC position that went out of range (75.05 - 110.42 USDC per SOL): ' +
  'close it and place it again around the current price, keeping its width.';

const at = (href: string) => {
  const replaced: string[] = [];
  (globalThis as { window?: unknown }).window = {
    location: { href, search: new URL(href).search },
    history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) },
  };
  return replaced;
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('AQuestionALinkBrings', () => {
  test('is read from the link an alert button opens', () => {
    at(`https://svinooh.com/p/vivid-cozy-stork?tab=agent&q=${encodeURIComponent(QUESTION)}`);
    assert.equal(questionInLink(), QUESTION);
  });

  test('is taken out of the address bar, and the tab it opened is left', () => {
    const replaced = at(`https://svinooh.com/p/vivid-cozy-stork?tab=agent&q=${encodeURIComponent(QUESTION)}`);
    forgetQuestionInLink();
    assert.deepEqual(replaced, ['https://svinooh.com/p/vivid-cozy-stork?tab=agent']);
  });

  test('a link with none asks nothing and changes nothing', () => {
    const replaced = at('https://svinooh.com/p/vivid-cozy-stork?tab=agent');
    assert.equal(questionInLink(), undefined);
    forgetQuestionInLink();
    assert.deepEqual(replaced, []);
  });

  test('on the server there is no address bar, and nothing breaks', () => {
    assert.equal(questionInLink(), undefined);
    forgetQuestionInLink();
  });
});
