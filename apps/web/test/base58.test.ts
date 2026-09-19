import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { base58 } from '../src/lib/deposit/wallet';

describe('ASignatureAsPeopleReadIt', () => {
  test('the known vectors', () => {
    assert.equal(base58(new Uint8Array([0])), '1');
    assert.equal(base58(new Uint8Array([0, 0, 0])), '111');
    assert.equal(base58(new Uint8Array([1])), '2');
    assert.equal(base58(new Uint8Array([57])), 'z');
    assert.equal(base58(new Uint8Array([58])), '21');
    assert.equal(base58(new Uint8Array([255, 255])), 'LUv');
  });

  test('a leading zero byte is a leading 1, not a lost byte', () => {
    assert.equal(base58(new Uint8Array([0, 1])), '12');
  });

  test('a signature comes out the length a signature is', () => {
    const signature = base58(new Uint8Array(64).fill(7));
    assert.ok(signature.length >= 86 && signature.length <= 88, signature.length.toString());
  });
});
