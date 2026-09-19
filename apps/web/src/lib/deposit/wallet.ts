import { useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet as StandardWallet, WalletAccount } from '@wallet-standard/base';

const CONNECT = 'standard:connect';
const DISCONNECT = 'standard:disconnect';
const SIGN_AND_SEND = 'solana:signAndSendTransaction';
const MAINNET = 'solana:mainnet';

export interface DepositSigner {
  address: string;
  signAndSend(transaction: string): Promise<string>;
  end(): Promise<void>;
}

export interface DepositWallet {
  id: string;
  name: string;
  icon: string | null;
  connect(): Promise<DepositSigner>;
}

interface ConnectFeature {
  connect(): Promise<{ accounts: readonly WalletAccount[] }>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface SignAndSendFeature {
  signAndSendTransaction(input: {
    account: WalletAccount;
    transaction: Uint8Array;
    chain: string;
  }): Promise<readonly { signature: Uint8Array }[]>;
}

const feature = <T,>(wallet: StandardWallet, name: string): T | null =>
  (wallet.features as Record<string, unknown>)[name] as T | null;

export const canSendOnSolana = (wallet: StandardWallet): boolean =>
  wallet.chains.some((chain) => chain.startsWith('solana:')) &&
  !!feature(wallet, CONNECT) &&
  !!feature(wallet, SIGN_AND_SEND);

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (const byte of bytes.subarray(zeros)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return BASE58[0].repeat(zeros) + digits.reverse().map((digit) => BASE58[digit]).join('');
}

export function depositWallet(wallet: StandardWallet): DepositWallet {
  return {
    id: `SOL:${wallet.name}`,
    name: wallet.name,
    icon: wallet.icon,
    connect: async () => {
      const connect = feature<ConnectFeature>(wallet, CONNECT);
      const send = feature<SignAndSendFeature>(wallet, SIGN_AND_SEND);
      if (!connect || !send) throw new Error(`${wallet.name} cannot send a transaction`);
      const { accounts } = await connect.connect();
      const account =
        accounts.find((one) => one.chains.some((chain) => chain.startsWith('solana:'))) ??
        accounts[0];
      if (!account) throw new Error(`${wallet.name} gave no account`);
      return {
        address: account.address,
        signAndSend: async (transaction) => {
          const [sent] = await send.signAndSendTransaction({
            account,
            transaction: fromBase64(transaction),
            chain: account.chains.find((c) => c.startsWith('solana:')) ?? MAINNET,
          });
          if (!sent?.signature) throw new Error('The wallet sent nothing back');
          return base58(sent.signature);
        },
        end: async () => {
          await feature<DisconnectFeature>(wallet, DISCONNECT)?.disconnect();
        },
      };
    },
  };
}

export function useDepositWallets(): DepositWallet[] {
  const [wallets, setWallets] = useState<DepositWallet[]>([]);
  useEffect(() => {
    const registry = getWallets();
    const read = () => setWallets(registry.get().filter(canSendOnSolana).map(depositWallet));
    read();
    const stop = [registry.on('register', read), registry.on('unregister', read)];
    return () => stop.forEach((off) => off());
  }, []);
  return wallets;
}
