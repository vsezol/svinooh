/**
 * The deposit path, in a real browser, against a wallet that is not a person.
 *
 * Everything here below the fakes is the code the site ships: the wallet
 * standard registry, useDeposits, runDeposit, the adapter that hands bytes to
 * a wallet, and the poll that waits for the chain. What is faked is the two
 * things a test cannot have — somebody's wallet and somebody's money.
 *
 * Build it with `npm run harness` and serve test/browser/dist on any port;
 * then drive window.harness from the console or from a browser tool:
 *
 *   harness.wallets(1)            one wallet that can sign — no chooser
 *   harness.build(422, {message}) what the server answers the next build
 *   await harness.deposit()       the press, and everything it produced
 *
 * What the agent is told about the outcome is agent-web's half, covered by its
 * own tests: nothing here may import another app, because the image this one
 * ships in carries only this one.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import { useDeposits } from '../../src/components/agent/useDeposits';
import type { DepositOutcome, DepositRequest } from '../../src/lib/deposit';
import { fakeWallet, OWNER, type Fake } from '../support/fake-wallet';

declare global {
  interface Window {
    harness: {
      wallets(count: number): number;
      build(status: number, body: unknown): void;
      landing(status: string): void;
      deposit(): Promise<unknown>;
    };
  }
}

const BYTES = new Uint8Array([1, 0, 2, 255, 128, 7]);
const TRANSACTION = btoa(String.fromCharCode(...BYTES));
const SIGNATURE_BYTES = new Uint8Array(64).fill(9);

const REQUEST: DepositRequest = {
  poolId: 'sol:kamino:vault:A3hTCWdnfV6uiQLxRmnv17EpiEtmc93v1AGQnWy44Mup',
  pool: 'Elemental USDC Turbo',
  protocol: 'kamino',
  poolKind: 'vault',
  network: 'sol',
  token: 'USDC',
  amount: '12.0014',
};

interface Served {
  build?: { status: number; body: unknown };
  landing?: string;
}

const served: Served = {};
const asked: { path: string; body: unknown }[] = [];

window.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
  const path = String(url);
  asked.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (path.includes('/deposits/build')) {
    const how = served.build ?? {
      status: 200,
      body: {
        transaction: TRANSACTION,
        feePayer: OWNER,
        instructions: 4,
        blockhash: 'b',
        lastValidBlockHeight: '1',
      },
    };
    return answer(how.status, how.body);
  }
  if (path.includes('/deposits/landed')) {
    return answer(200, {
      signature: 's',
      owner: OWNER,
      status: served.landing ?? 'landed',
      slot: 7,
      error: null,
      tracked: true,
      portfolio: 'vivid-cozy-stork',
    });
  }
  return answer(404, { message: `nothing serves ${path}` });
}) as typeof fetch;

let press: ((request: DepositRequest) => Promise<DepositOutcome>) | null = null;
let dialogShown = false;

function Harness() {
  const { onDeposit, asked: askedToDeposit } = useDeposits();
  const [wallets, setWallets] = useState(0);
  press = onDeposit;
  dialogShown = askedToDeposit !== null;
  return (
    <div>
      <div id="wallets">wallets: {wallets}</div>
      <div id="dialog">{askedToDeposit ? 'a dialog is asking which wallet' : 'no dialog'}</div>
      <button id="count" onClick={() => setWallets((n) => n + 1)} style={{ display: 'none' }}>
        redraw
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);

const registry = getWallets();
const registered: Array<() => void> = [];
const fakes: Fake[] = [];

function say(value: unknown): void {
  document.getElementById('out')!.textContent = JSON.stringify(value, null, 2);
}

window.harness = {
  /** Puts N wallets that can sign on Solana into the registry the site reads. */
  wallets(count: number) {
    for (const unregister of registered.splice(0)) unregister();
    fakes.splice(0);
    for (let n = 0; n < count; n++) {
      const fake = fakeWallet({ name: `Fake ${n + 1}`, signature: SIGNATURE_BYTES });
      fakes.push(fake);
      registered.push(registry.register(fake.wallet as never));
    }
    return count;
  },
  /** What the server will answer the next build with. */
  build(status: number, body: unknown) {
    served.build = { status, body };
  },
  landing(status: string) {
    served.landing = status;
  },
  async deposit() {
    asked.splice(0);
    for (const fake of fakes) fake.handed.splice(0);
    const outcome = await press!(REQUEST);
    const result = {
      outcome,
      dialogShown,
      asked: asked.map((one) => ({ path: one.path.replace(/^.*\/api/, '/api'), body: one.body })),
      handed: fakes.flatMap((fake) =>
        fake.handed.map((one) => ({
          transaction: Array.from(one.transaction),
          chain: one.chain,
          account: one.account,
        })),
      ),
    };
    say(result);
    return result;
  },
};

say({ ready: true });
