import { strict as assert } from 'node:assert';
import { beforeEach, describe, test } from 'node:test';
import { parkReturn, takeReturn } from '../src/lib/after-signin';

/** The browser's, in as much of it as this module touches. */
const store = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe('WhereASignInComesBackTo', () => {
  beforeEach(() => store.clear());

  test('carries a path across the round trip', () => {
    parkReturn('/ai/c/2Z5rqW');
    assert.equal(takeReturn(), '/ai/c/2Z5rqW');
  });

  test('is spent on reading, so a later sign-in lands where it should', () => {
    parkReturn('/ai');
    takeReturn();
    assert.equal(takeReturn(), null);
  });

  test('says nothing when nothing was asked for', () => {
    assert.equal(takeReturn(), null);
  });

  test('refuses anything that is not a path on this site', () => {
    // The value is read straight back into router.replace. A protocol-relative
    // path is the open redirect that shape is famous for: //evil.example is a
    // host, not a path.
    for (const hostile of ['//evil.example/pwn', 'https://evil.example', 'javascript:alert(1)', 'ai', '']) {
      store.clear();
      parkReturn(hostile);
      assert.equal(takeReturn(), null, hostile);
    }
  });

  test('refuses one that was planted in storage rather than parked', () => {
    // Read as well as write, because storage is the attacker's side of this.
    store.set('svinooh_after_signin', '//evil.example/pwn');
    assert.equal(takeReturn(), null);
  });
});
