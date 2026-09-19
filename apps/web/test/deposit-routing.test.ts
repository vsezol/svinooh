import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { buildDeposit, depositsInto, DepositNotSupportedError } from '../src/lib/deposit';
import type { DepositRequest } from '../src/lib/deposit';

const request = (over: Partial<DepositRequest> = {}): DepositRequest => ({
  poolId: 'sol:kamino:vault:AAA',
  pool: 'Steakhouse USDC',
  protocol: 'kamino',
  poolKind: 'vault',
  network: 'sol',
  token: 'USDC',
  amount: '250',
  accounts: { programId: 'KLend', address: 'AAA', tokenMint: 'EPjF', tokenDecimals: 6 },
  ...over,
});

const refused = async (over: Partial<DepositRequest>): Promise<string> => {
  try {
    await buildDeposit(request(over), 'owner', 'http://rpc.invalid');
    return 'it built something';
  } catch (error) {
    if (error instanceof DepositNotSupportedError) return error.message;
    throw error;
  }
};

describe('WhichProtocolBuildsADeposit', () => {
  test('kamino on solana has one', () => {
    const into = depositsInto(request());
    assert.equal(into?.protocol, 'kamino');
    assert.equal(into?.network, 'sol');
  });

  test('a protocol nobody wired yet is named in the refusal', async () => {
    assert.equal(depositsInto(request({ protocol: 'meteora' })), null);
    assert.match(await refused({ protocol: 'meteora' }), /meteora on sol is not wired/);
  });

  test('a chain nobody wired yet is refused before any SDK loads', async () => {
    assert.equal(depositsInto(request({ network: 'eth', protocol: 'aave3' })), null);
    assert.match(await refused({ network: 'eth', protocol: 'aave3' }), /aave3 on eth is not wired/);
  });

  test('a pool shape its own protocol does not handle is refused too', async () => {
    assert.equal(depositsInto(request({ poolKind: 'farm' }))?.supports(request({ poolKind: 'farm' })), false);
    assert.match(await refused({ poolKind: 'farm' }), /kamino farm pools are not wired/);
  });
});
