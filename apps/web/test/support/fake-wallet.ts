import type { Wallet as StandardWallet } from '@wallet-standard/base';

export const OWNER = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';

export interface Handed {
  transaction: Uint8Array;
  chain: string;
  account: string;
}

export interface Fake {
  wallet: StandardWallet;
  handed: Handed[];
  disconnected: () => boolean;
}

interface Made {
  name?: string;
  signature?: Uint8Array;
  refuse?: string;
  sendsNothing?: boolean;
  chains?: string[];
  accounts?: { address: string; chains: string[] }[];
  canSign?: boolean;
}

export function fakeWallet(made: Made = {}): Fake {
  const handed: Handed[] = [];
  let gone = false;
  const accounts = (made.accounts ?? [{ address: OWNER, chains: ['solana:mainnet'] }]).map(
    (one) => ({ ...one, publicKey: new Uint8Array(32), features: [] }),
  );
  const features: Record<string, unknown> = {
    'standard:connect': { version: '1.0.0', connect: async () => ({ accounts }) },
    'standard:disconnect': {
      version: '1.0.0',
      disconnect: async () => {
        gone = true;
      },
    },
  };
  if (made.canSign !== false) {
    features['solana:signAndSendTransaction'] = {
      version: '1.0.0',
      signAndSendTransaction: async (input: {
        account: { address: string };
        transaction: Uint8Array;
        chain: string;
      }) => {
        if (made.refuse) throw new Error(made.refuse);
        handed.push({
          transaction: input.transaction,
          chain: input.chain,
          account: input.account.address,
        });
        return made.sendsNothing ? [{}] : [{ signature: made.signature ?? new Uint8Array(64).fill(9) }];
      },
    };
  }
  const wallet = {
    version: '1.0.0',
    name: made.name ?? 'Phantom',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains: made.chains ?? ['solana:mainnet'],
    accounts,
    features,
  } as unknown as StandardWallet;
  return { wallet, handed, disconnected: () => gone };
}
