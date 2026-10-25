import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { tableAt } from '../src/agent/components/blocks/Markdown';

const linesOf = (text: string): string[] => text.trim().split('\n');

describe('TablesTheModelWrites', () => {
  test('reads a header, its alignment and its rows', () => {
    const table = tableAt(
      linesOf(`
| Pool | Rate | Risk |
| --- | ---: | :---: |
| Elemental USDC Turbo | 10.84% | low |
| GM-Sanctum | 16.91% | high |
`),
      0,
    );
    assert.ok(table);
    assert.deepEqual(table.head, ['Pool', 'Rate', 'Risk']);
    assert.deepEqual(table.align, [undefined, 'right', 'center']);
    assert.deepEqual(table.rows, [
      ['Elemental USDC Turbo', '10.84%', 'low'],
      ['GM-Sanctum', '16.91%', 'high'],
    ]);
    assert.equal(table.next, 4);
  });

  test('a short row is padded and a long one is cut to the header', () => {
    const table = tableAt(linesOf('| A | B |\n| --- | --- |\n| only |\n| one | two | three |'), 0);
    assert.deepEqual(table?.rows, [
      ['only', ''],
      ['one', 'two'],
    ]);
  });

  test('rows may be written without the outer pipes', () => {
    const table = tableAt(linesOf('A | B\n--- | ---\n1 | 2'), 0);
    assert.deepEqual(table?.head, ['A', 'B']);
    assert.deepEqual(table?.rows, [['1', '2']]);
  });

  test('a sentence with a pipe in it is not a table', () => {
    assert.equal(tableAt(['The range is 1.2 | 1.8 wide', 'and it holds.'], 0), null);
    assert.equal(tableAt(['Prices | ranges', '---'], 0), null);
  });

  test('a delimiter that does not match the header is not a table', () => {
    assert.equal(tableAt(['| A | B | C |', '| --- | --- |', '| 1 | 2 | 3 |'], 0), null);
  });

  test('an escaped pipe stays inside its cell', () => {
    const table = tableAt(['| A | B |', '| --- | --- |', '| a \\| b | c |'], 0);
    assert.deepEqual(table?.rows, [['a | b', 'c']]);
  });
});
