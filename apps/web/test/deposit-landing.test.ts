import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { followDeposit } from '../src/lib/deposit';

const SIGNATURE = '5ndCyVRV3mQRLmTdhKbJdFVWEPfYhfqZmAaLvQnqaJ8pZJqvHkBQ7kkbXHbPMRLzrXhDcQAqfHuNvAhVQDWkZqYh';
const OWNER = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';

const answering = (statuses: string[]) => {
  const asked: unknown[] = [];
  const fetching = async (_url: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)));
    const status = statuses[Math.min(asked.length - 1, statuses.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ status, slot: 1, error: null, tracked: true, portfolio: 'p' }),
    } as Response;
  };
  return { asked, fetching };
};

const follow = (statuses: string[]) => {
  const { asked, fetching } = answering(statuses);
  globalThis.fetch = fetching as typeof fetch;
  return { asked, done: followDeposit(SIGNATURE, OWNER, 'sol', async () => {}) };
};

describe('WaitingForADepositToLand', () => {
  test('one answer is enough when the chain already has it', async () => {
    const { asked, done } = follow(['landed']);
    const seen = await done;
    assert.equal(seen.status, 'landed');
    assert.equal(asked.length, 1);
  });

  test('pending is asked again until it is not', async () => {
    const { asked, done } = follow(['pending', 'pending', 'landed']);
    const seen = await done;
    assert.equal(seen.status, 'landed');
    assert.equal(asked.length, 3);
  });

  test('a failure stops the waiting as surely as a landing', async () => {
    const { asked, done } = follow(['pending', 'failed']);
    assert.equal((await done).status, 'failed');
    assert.equal(asked.length, 2);
  });

  test('a chain that never answers gives up rather than waiting forever', async () => {
    const { asked, done } = follow(['pending']);
    assert.equal((await done).status, 'pending');
    assert.equal(asked.length, 20);
  });

  test('every ask names the signature, the owner and the chain', async () => {
    const { asked, done } = follow(['landed']);
    await done;
    assert.deepEqual(asked[0], { signature: SIGNATURE, owner: OWNER, network: 'sol' });
  });
});
