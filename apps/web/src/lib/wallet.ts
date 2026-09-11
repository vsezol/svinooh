import { useEffect, useState } from 'react';
import type { AuthResponseDto, WalletChallengeDto } from '@svinooh/shared';
import { api } from './api';

/**
 * Signing in with a crypto wallet.
 *
 * Two things talk to a wallet and there is no third: the browser extension the
 * visitor already has, and WalletConnect for everything that lives on a phone.
 * Between them that is every wallet worth naming, which is the point — the
 * alternative is a list of integrations that is out of date the week it ships.
 *
 *  - **The extension** announces itself (EIP-6963): MetaMask, Rabby, Phantom,
 *    Coinbase, Brave and the rest each fire an event saying what they are
 *    called and what they look like, and hand us a provider. We show what
 *    answered rather than guessing what is installed, and clicking one is a
 *    single prompt on the machine the visitor is already using.
 *  - **WalletConnect** is one relay and a QR code standing in for the other six
 *    hundred wallets. It is loaded only when it is chosen: the library is large
 *    and most sign-ins never touch it.
 *
 * Both end up as the same EIP-1193 object, so the sign-in below is written once.
 */

/** The only shape of a wallet this file knows: EIP-1193 */
export interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  disconnect?(): Promise<void>;
}

/** What EIP-6963 tells us about a wallet that announced itself */
interface Eip6963Info {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

/** One row of the picker: a wallet that is here now, ready to be asked */
export interface WalletChoice {
  id: string;
  name: string;
  /** A data URI the wallet supplies — its own mark, drawn by nobody here */
  icon: string | null;
  provider: WalletProvider;
}

interface AnnounceEvent extends Event {
  detail?: { info?: Eip6963Info; provider?: WalletProvider };
}

/**
 * The wallets this browser has, as they announce themselves.
 *
 * A hook because the announcements are events: the page asks once, and every
 * installed wallet answers whenever it is ready — so the list is what actually
 * replied, never a guess about what somebody might have installed.
 *
 * The fallback is the exception to that. EIP-6963 is what every current
 * extension speaks, but the in-app browsers — Trust, TokenPocket, a wallet's
 * own tab — are often a version behind and leave a provider on
 * `window.ethereum` without a word. It stands in for the whole list when
 * nothing announced at all, and never joins one, because beside a wallet that
 * did announce it is the same wallet twice under a name nobody chose.
 */
export function useBrowserWallets(): WalletChoice[] {
  const [announced, setAnnounced] = useState<WalletChoice[]>([]);
  const [legacy, setLegacy] = useState<WalletChoice | null>(null);

  useEffect(() => {
    const heard = (event: Event) => {
      const { info, provider } = (event as AnnounceEvent).detail ?? {};
      if (!info?.rdns || !provider) return;
      setAnnounced((was) =>
        // The same wallet may announce more than once; its rdns is what it is
        was.some((w) => w.id === info.rdns)
          ? was
          : [...was, { id: info.rdns, name: info.name, icon: info.icon ?? null, provider }],
      );
    };
    window.addEventListener('eip6963:announceProvider', heard);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const injected = (window as { ethereum?: WalletProvider }).ethereum;
    if (injected && typeof injected.request === 'function') {
      setLegacy({ id: 'injected', name: 'Browser wallet', icon: null, provider: injected });
    }
    return () => window.removeEventListener('eip6963:announceProvider', heard);
  }, []);

  return announced.length ? announced : legacy ? [legacy] : [];
}

/**
 * WalletConnect, fetched at the moment it is chosen.
 *
 * `showQrModal` hands the QR, the wallet list and every mobile deep link to
 * their modal — the one piece of interface here that is not ours, and the one
 * place where being the same as every other site is the feature: a QR screen
 * people already recognise, kept current with wallets we have never heard of.
 */
export async function connectWalletConnect(projectId: string): Promise<WalletProvider> {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const provider = await EthereumProvider.init({
    projectId,
    // Ethereum to ask for, the big EVM chains to accept: a wallet sitting on
    // Base has no reason to be told to switch networks to prove who it is
    chains: [1],
    optionalChains: [10, 56, 137, 8453, 42161, 43114],
    // A signature and nothing else. A session that cannot ask for a
    // transaction is a session that cannot be talked into sending one.
    methods: ['personal_sign'],
    events: ['accountsChanged', 'chainChanged'],
    showQrModal: true,
    metadata: {
      name: 'Svinooh',
      description: 'Every wallet you have, on one page',
      url: window.location.origin,
      icons: [`${window.location.origin}/icon-512.png`],
    },
  });
  await provider.enable();
  return provider as unknown as WalletProvider;
}

/** personal_sign takes bytes; wallets decode them back to the text they show */
const toHex = (text: string): string =>
  `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * The whole sign-in: an address, a sentence from the server, a signature.
 *
 * The text is never written here — the server hands it over and checks it back
 * against what it stored. A browser that composed its own message would be a
 * browser that could choose what an address appears to have agreed to.
 */
export async function signInWithWallet(provider: WalletProvider): Promise<AuthResponseDto> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error('The wallet gave no address');

  // Named in the message so the wallet is not asked to sign a sentence about a
  // network it is not on — several of them warn about exactly that
  const chainIdRaw = await provider.request({ method: 'eth_chainId' }).catch(() => '0x1');
  const chainId = Number.parseInt(String(chainIdRaw), 16) || 1;

  const challenge = await api<WalletChallengeDto>('/auth/wallet/nonce', {
    method: 'POST',
    body: JSON.stringify({ address, chainId }),
  });
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [toHex(challenge.message), address],
  })) as string;

  return api<AuthResponseDto>('/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
}

/**
 * Hang up on the wallet once the signature is in.
 *
 * The session was worth exactly one message, and leaving it open leaves a live
 * pairing in somebody's wallet for a site that has no further use for it. The
 * account we just made is held by our own token, not by this connection.
 */
export async function endWalletSession(provider: WalletProvider): Promise<void> {
  try {
    await provider.disconnect?.();
  } catch {
    // An extension has nothing to hang up, and a relay that has already gone
    // quiet is the outcome we wanted anyway
  }
}

/** What a wallet says when it means "no" — the one refusal that isn't an error */
export function declined(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  return code === 4001 || code === 'ACTION_REJECTED' || code === 5000;
}
