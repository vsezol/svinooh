import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { base58, canSendOnSolana, depositWallet } from '../src/lib/deposit/wallet';
import { fakeWallet, OWNER } from './support/fake-wallet';

const BYTES = new Uint8Array([1, 0, 2, 255, 128, 7]);
const TRANSACTION = Buffer.from(BYTES).toString('base64');

describe('AWalletThisSiteCanDepositThrough', () => {
  test('one that can sign and send on solana is offered', () => {
    assert.equal(canSendOnSolana(fakeWallet().wallet), true);
  });

  test('one that only connects is not, however solana it says it is', () => {
    assert.equal(canSendOnSolana(fakeWallet({ canSign: false }).wallet), false);
  });

  test('one on another chain is not', () => {
    assert.equal(canSendOnSolana(fakeWallet({ chains: ['eip155:1'] }).wallet), false);
  });
});

describe('SendingADepositThroughAWallet', () => {
  test('the wallet gets the bytes the server built, not the text', async () => {
    const fake = fakeWallet();
    const signer = await depositWallet(fake.wallet).connect();
    await signer.signAndSend(TRANSACTION);
    assert.deepEqual(fake.handed[0].transaction, BYTES);
  });

  test('it is asked on the chain the account is on', async () => {
    const fake = fakeWallet();
    const signer = await depositWallet(fake.wallet).connect();
    await signer.signAndSend(TRANSACTION);
    assert.equal(fake.handed[0].chain, 'solana:mainnet');
    assert.equal(fake.handed[0].account, OWNER);
  });

  test('the signature comes back as a signature is written', async () => {
    const fake = fakeWallet({ signature: new Uint8Array(64).fill(1) });
    const signer = await depositWallet(fake.wallet).connect();
    assert.equal(await signer.signAndSend(TRANSACTION), base58(new Uint8Array(64).fill(1)));
  });

  test('the solana account is the one used, not whichever came first', async () => {
    const fake = fakeWallet({
      accounts: [
        { address: '0xabc', chains: ['eip155:1'] },
        { address: OWNER, chains: ['solana:mainnet'] },
      ],
    });
    assert.equal((await depositWallet(fake.wallet).connect()).address, OWNER);
  });

  test('a wallet that sends nothing back is an error, not a deposit', async () => {
    const fake = fakeWallet({ sendsNothing: true });
    const signer = await depositWallet(fake.wallet).connect();
    await assert.rejects(signer.signAndSend(TRANSACTION), /sent nothing back/);
  });

  test("a refusal in the wallet is the wallet's own words", async () => {
    const fake = fakeWallet({ refuse: 'User rejected the request.' });
    const signer = await depositWallet(fake.wallet).connect();
    await assert.rejects(signer.signAndSend(TRANSACTION), /User rejected/);
  });

  test('letting go disconnects', async () => {
    const fake = fakeWallet();
    const signer = await depositWallet(fake.wallet).connect();
    await signer.end();
    assert.equal(fake.disconnected(), true);
  });
});
