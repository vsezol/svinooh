import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { ChoiceBlock } from '../src/app/types';
import { answerOf } from '../src/components/blocks/ChoiceBlock';

const card: ChoiceBlock = {
  kind: 'choice',
  header: 'Токен',
  question: 'Что размещаем?',
  options: ['USDC 12.00', 'SOL 0.009'],
};

describe('WhatATappedAnswerSays', () => {
  test('the answer names what was being chosen, not only the choice', () => {
    assert.equal(answerOf(card, 'USDC 12.00'), 'Токен: USDC 12.00');
  });

  test('two questions in a turn stay apart by their headers', () => {
    const risk: ChoiceBlock = { ...card, header: 'Риск', options: ['Спокойно', 'Повыше ставка'] };
    assert.notEqual(answerOf(card, 'USDC 12.00'), answerOf(risk, 'Спокойно'));
    assert.match(answerOf(risk, 'Спокойно'), /^Риск: /);
  });
});
