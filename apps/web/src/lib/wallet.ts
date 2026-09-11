import { useEffect, useMemo, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet as StandardWallet, WalletAccount } from '@wallet-standard/base';
import type { AuthResponseDto, Chain, WalletChallengeDto } from '@svinooh/shared';
import { api } from './api';

/**
 * Signing in with a crypto wallet.
 *
 * Nothing here knows the name of a single wallet, which is the point. Two
 * ecosystems, two ways a wallet introduces itself to a page, and in both of
 * them it is the wallet doing the talking:
 *
 *  - **Solana** — the Wallet Standard. Phantom, Solflare, Backpack and the rest
 *    register themselves with the page, handing over a name, an icon and the
 *    two features a sign-in needs.
 *  - **EVM** — EIP-6963. MetaMask, Rabby, Coinbase, Brave and the rest each
 *    announce the same three things.
 *
 * So the list is whatever answered THIS browser: it cannot go stale, it never
 * offers a wallet that is not installed, and it gains a new wallet the day that
 * wallet ships. A wallet that does both — Phantom does — appears once per
 * chain, because those are two different addresses and the one somebody signs
 * with is the one that becomes their account.
 *
 * Under the two adapters there is a single sign-in: connect, ask the server for
 * a sentence, sign it. The chains differ in how a signature is made and how it
 * is spelled on the wire, and in nothing else.
 */

/** A wallet connected and ready to sign the one sentence we need */
interface Session {
  address: string;
  /** Which EVM network the wallet is on, for the message that names it */
  chainId?: number;
  /**
   * Solana signs bytes and gives back 64 of them, sent as base64; EVM signs
   * text and gives back 0x-hex. The server knows which to expect from the
   * address it issued the challenge for, so one field carries both.
   */
  sign(message: string): Promise<string>;
  /** Let go — the connection was worth exactly one message */
  end(): Promise<void>;
}

/** One row of the picker: a wallet that is here now, on one of its chains */
export interface WalletChoice {
  /** Unique per row — a wallet that speaks both chains has two */
  id: string;
  name: string;
  /** A data URI the wallet supplies — its own mark, drawn by nobody here */
  icon: string | null;
  chain: Chain;
  connect(): Promise<Session>;
}

// ------------------------------------------------------------------ Solana

const CONNECT = 'standard:connect';
const DISCONNECT = 'standard:disconnect';
const SIGN_MESSAGE = 'solana:signMessage';

interface ConnectFeature {
  connect(): Promise<{ accounts: readonly WalletAccount[] }>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface SignMessageFeature {
  signMessage(input: {
    account: WalletAccount;
    message: Uint8Array;
  }): Promise<readonly { signature: Uint8Array }[]>;
}

const feature = <T,>(wallet: StandardWallet, name: string): T | null =>
  (wallet.features as Record<string, unknown>)[name] as T | null;

/** Solana, whichever cluster — the signature is the same on all of them */
const speaksSolana = (wallet: StandardWallet): boolean =>
  wallet.chains.some((chain) => chain.startsWith('solana:')) &&
  !!feature(wallet, CONNECT) &&
  !!feature(wallet, SIGN_MESSAGE);

/** 64 bytes as base64 — the one encoding both ends already have */
const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

const solanaChoice = (wallet: StandardWallet): WalletChoice => ({
  id: `SOL:${wallet.name}`,
  name: wallet.name,
  icon: wallet.icon,
  chain: 'SOL',
  connect: async () => {
    const connect = feature<ConnectFeature>(wallet, CONNECT);
    const sign = feature<SignMessageFeature>(wallet, SIGN_MESSAGE);
    if (!connect || !sign) throw new Error(`${wallet.name} cannot sign a message`);
    const { accounts } = await connect.connect();
    const account =
      accounts.find((one) => one.chains.some((chain) => chain.startsWith('solana:'))) ?? accounts[0];
    if (!account) throw new Error(`${wallet.name} gave no account`);
    return {
      address: account.address,
      sign: async (message) => {
        const [signed] = await sign.signMessage({
          account,
          message: new TextEncoder().encode(message),
        });
        if (!signed?.signature) throw new Error('The wallet returned no signature');
        return toBase64(signed.signature);
      },
      end: async () => {
        await feature<DisconnectFeature>(wallet, DISCONNECT)?.disconnect();
      },
    };
  },
});

/**
 * The Solana wallets this browser has.
 *
 * Registration is an event in both directions: the page says it is ready,
 * wallets already loaded answer at once, and one that loads later announces
 * itself when it does. `getWallets()` runs that handshake, so an extension
 * installed while the modal is open turns up in the list.
 */
function useSolanaWallets(): WalletChoice[] {
  const [wallets, setWallets] = useState<WalletChoice[]>([]);

  useEffect(() => {
    const registry = getWallets();
    const read = () => setWallets(registry.get().filter(speaksSolana).map(solanaChoice));
    read();
    const stop = [registry.on('register', read), registry.on('unregister', read)];
    return () => stop.forEach((off) => off());
  }, []);

  return wallets;
}

// --------------------------------------------------------------------- EVM

/** The only shape of an EVM wallet this file knows: EIP-1193 */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** What EIP-6963 tells us about a wallet that announced itself */
interface Eip6963Info {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface AnnounceEvent extends Event {
  detail?: { info?: Eip6963Info; provider?: Eip1193Provider };
}

/** personal_sign takes bytes; wallets decode them back to the text they show */
const toHex = (text: string): string =>
  `0x${Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

const evmChoice = (
  info: { name: string; icon: string | null; key: string },
  provider: Eip1193Provider,
): WalletChoice => ({
  id: `EVM:${info.key}`,
  name: info.name,
  icon: info.icon,
  chain: 'EVM',
  connect: async () => {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    const address = accounts?.[0];
    if (!address) throw new Error(`${info.name} gave no address`);
    // Named in the message so the wallet is not asked to sign a sentence about
    // a network it is not on — several of them warn about exactly that
    const chainIdRaw = await provider.request({ method: 'eth_chainId' }).catch(() => '0x1');
    return {
      address,
      chainId: Number.parseInt(String(chainIdRaw), 16) || 1,
      sign: async (message) =>
        (await provider.request({
          method: 'personal_sign',
          params: [toHex(message), address],
        })) as string,
      // An extension has nothing to hang up: the page holds no session, and
      // what it may read next time is the extension's own business
      end: async () => {},
    };
  },
});

/**
 * The EVM wallets this browser has.
 *
 * The page asks once and every installed wallet answers. The fallback is the
 * exception: EIP-6963 is what every current extension speaks, but the in-app
 * browsers — Trust, TokenPocket, a wallet's own tab — are often a version
 * behind and leave a provider on `window.ethereum` without a word. It stands in
 * for the whole list when nothing announced, and never joins one, because
 * beside a wallet that did announce it is the same wallet twice under a name
 * nobody chose.
 */
function useEvmWallets(): WalletChoice[] {
  const [announced, setAnnounced] = useState<WalletChoice[]>([]);
  const [legacy, setLegacy] = useState<WalletChoice | null>(null);

  useEffect(() => {
    const heard = (event: Event) => {
      const { info, provider } = (event as AnnounceEvent).detail ?? {};
      if (!info?.rdns || !provider) return;
      setAnnounced((was) =>
        // The same wallet may announce more than once; its rdns is what it is
        was.some((one) => one.id === `EVM:${info.rdns}`)
          ? was
          : [
              ...was,
              evmChoice({ name: info.name, icon: info.icon ?? null, key: info.rdns }, provider),
            ],
      );
    };
    window.addEventListener('eip6963:announceProvider', heard);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
    if (injected && typeof injected.request === 'function') {
      setLegacy(evmChoice({ name: 'Browser wallet', icon: null, key: 'injected' }, injected));
    }
    return () => window.removeEventListener('eip6963:announceProvider', heard);
  }, []);

  return announced.length ? announced : legacy ? [legacy] : [];
}

// ------------------------------------------------------------ both of them

/**
 * Every wallet that answered, in one list.
 *
 * Sorted by name, so a wallet that speaks both chains keeps its two rows
 * together and the order does not depend on which extension happened to
 * announce itself first.
 */
export function useWallets(): WalletChoice[] {
  const solana = useSolanaWallets();
  const evm = useEvmWallets();
  return useMemo(
    () =>
      [...solana, ...evm].sort(
        (a, b) => a.name.localeCompare(b.name) || a.chain.localeCompare(b.chain),
      ),
    [solana, evm],
  );
}

/**
 * The whole sign-in: connect, ask the server for a sentence, sign it.
 *
 * The text is never written here — the server hands it over and checks it back
 * against what it stored. A browser that composed its own message would be a
 * browser that could choose what an address appears to have agreed to.
 *
 * The portfolio that comes back already holds this address: a wallet account's
 * portfolio is created holding it, in the same statement — see
 * UserService.startsHolding.
 */
export async function signInWithWallet(choice: WalletChoice): Promise<AuthResponseDto> {
  const session = await choice.connect();
  try {
    const challenge = await api<WalletChallengeDto>('/auth/wallet/nonce', {
      method: 'POST',
      body: JSON.stringify({ address: session.address, chainId: session.chainId }),
    });
    const signature = await session.sign(challenge.message);
    return await api<AuthResponseDto>('/auth/wallet/verify', {
      method: 'POST',
      body: JSON.stringify({ nonce: challenge.nonce, signature }),
    });
  } finally {
    // However it ended. A connection left open is a site sitting in somebody's
    // wallet for a page with no further use for it; what keeps them signed in
    // is our own token.
    void session.end().catch(() => undefined);
  }
}

/** What a wallet says when it means "no" — the one refusal that isn't an error */
export function declined(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  // The Wallet Standard has no code for it; every wallet words it differently,
  // and all of them say one of these
  const message = String((err as { message?: string })?.message ?? '').toLowerCase();
  return message.includes('reject') || message.includes('declined') || message.includes('cancel');
}
