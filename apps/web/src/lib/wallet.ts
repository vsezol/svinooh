import { useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { AuthResponseDto, WalletChallengeDto } from '@svinooh/shared';
import { api } from './api';

/**
 * Signing in with a Solana wallet.
 *
 * Nothing here knows the name of a single wallet, which is the point. Phantom,
 * Solflare, Backpack and the rest all speak the **Wallet Standard**: they
 * register themselves with the page, and what they register is a name, an icon
 * and the two things we need — connect, and sign a message. So the list is
 * whatever answered this browser, and it never goes stale, never names a wallet
 * that is not installed, and gains a new wallet the day that wallet ships
 * without a line changing here.
 *
 * The proof is one signature over a sentence the server wrote. A Solana address
 * IS an ed25519 public key, so the server checks it with no library, no node
 * and no network — see WalletLoginService.
 */

/** A wallet that is here now and can do both halves of a sign-in */
export interface WalletChoice {
  /** The wallet's own name, which is also what makes it unique in the list */
  name: string;
  icon: string;
  wallet: Wallet;
}

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

const feature = <T,>(wallet: Wallet, name: string): T | null =>
  (wallet.features as Record<string, unknown>)[name] as T | null;

/** Solana, whichever cluster — the signature is the same on all of them */
const speaksSolana = (wallet: Wallet): boolean =>
  wallet.chains.some((chain) => chain.startsWith('solana:')) &&
  !!feature(wallet, CONNECT) &&
  !!feature(wallet, SIGN_MESSAGE);

/**
 * The Solana wallets this browser has.
 *
 * A hook because registration is an event in both directions: the page says it
 * is ready, wallets already loaded answer at once, and one that loads later
 * announces itself when it does. `getWallets()` handles that handshake — an
 * extension installed while the modal is open turns up in the list.
 */
export function useSolanaWallets(): WalletChoice[] {
  const [wallets, setWallets] = useState<WalletChoice[]>([]);

  useEffect(() => {
    const registry = getWallets();
    const read = () =>
      setWallets(
        registry
          .get()
          .filter(speaksSolana)
          .map((wallet) => ({ name: wallet.name, icon: wallet.icon, wallet })),
      );
    read();
    const stop = [registry.on('register', read), registry.on('unregister', read)];
    return () => stop.forEach((off) => off());
  }, []);

  return wallets;
}

/** The account this wallet signs Solana with */
const solanaAccount = (accounts: readonly WalletAccount[]): WalletAccount | undefined =>
  accounts.find((account) => account.chains.some((chain) => chain.startsWith('solana:'))) ?? accounts[0];

/** 64 bytes on the wire, as base64 — the one encoding both ends already have */
const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

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
export async function signInWithWallet(wallet: Wallet): Promise<AuthResponseDto> {
  const connect = feature<ConnectFeature>(wallet, CONNECT);
  const sign = feature<SignMessageFeature>(wallet, SIGN_MESSAGE);
  if (!connect || !sign) throw new Error(`${wallet.name} cannot sign a message`);

  const { accounts } = await connect.connect();
  const account = solanaAccount(accounts);
  if (!account) throw new Error(`${wallet.name} gave no account`);

  const challenge = await api<WalletChallengeDto>('/auth/wallet/nonce', {
    method: 'POST',
    body: JSON.stringify({ address: account.address }),
  });
  const [signed] = await sign.signMessage({
    account,
    message: new TextEncoder().encode(challenge.message),
  });
  if (!signed?.signature) throw new Error('The wallet returned no signature');

  return api<AuthResponseDto>('/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify({ nonce: challenge.nonce, signature: toBase64(signed.signature) }),
  });
}

/**
 * Hang up once the signature is in.
 *
 * The connection was worth exactly one message. Left open it is a site sitting
 * in somebody's wallet with permission to read which address they are — for a
 * page that has no further use for it. What keeps them signed in is our own
 * token, not this.
 */
export async function endWalletSession(wallet: Wallet): Promise<void> {
  try {
    await feature<DisconnectFeature>(wallet, DISCONNECT)?.disconnect();
  } catch {
    // A wallet with nothing to hang up is the outcome we wanted anyway
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
