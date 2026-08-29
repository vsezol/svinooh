import {
  NetworkArbitrumOne,
  NetworkAvalanche,
  NetworkBerachain,
  NetworkBitcoin,
  NetworkBlast,
  NetworkBinanceSmartChain,
  NetworkCelo,
  NetworkEthereum,
  NetworkFantom,
  NetworkGnosis,
  NetworkHyperEvm,
  NetworkLinea,
  NetworkMantle,
  NetworkOptimism,
  NetworkPolygon,
  NetworkScroll,
  NetworkSolana,
  NetworkSonic,
  NetworkTron,
  NetworkUnichain,
  NetworkZksync,
} from '@web3icons/react';
import type { ComponentType, CSSProperties } from 'react';

/**
 * Base, drawn here rather than taken from the set.
 *
 * @web3icons ships every variant of Base as a bare blue rounded square with no
 * glyph on it at all — the mark is simply missing (checked against 4.1.21, the
 * latest; every other network we use is intact). A blank tile is worse than the
 * approximations this component exists to replace, so this is Base's real mark:
 * the path is @token-icons/core's, another published icon set, and the colour
 * is Base's own #0052FF.
 */
function NetworkBase({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        fill="#0052FF"
        d="M11.983 22C17.515 22 22 17.523 22 12S17.515 2 11.983 2C6.733 2 2.428 6.03 2 11.16h13.24v1.68H2C2.428 17.97 6.734 22 11.983 22"
      />
    </svg>
  );
}

/**
 * A network, drawn as the network draws itself.
 *
 * The marks are @web3icons/react — the real ones, in their own colours, rather
 * than shapes that look about right. A wallet is a list of other people's
 * brands and half of telling them apart at a glance is that Base is that blue
 * and Arbitrum is that other blue; an approximation of a logo is a logo that is
 * wrong, and on a page about somebody's money looking wrong is expensive.
 *
 * Keyed by the slug the scanners report (`network` on a position), which is
 * DeBank's id for the EVM networks and our own chain in lower case for the
 * three families that have exactly one.
 */
interface Network {
  name: string;
  /** The brand's own colour, for the disc the mark sits on */
  tint: string;
  Icon: ComponentType<{ size?: number; variant?: 'mono' | 'branded' | 'background' }>;
}

const NETWORKS: Record<string, Network> = {
  eth: { name: 'Ethereum', tint: '#627EEA', Icon: NetworkEthereum },
  arb: { name: 'Arbitrum', tint: '#12AAFF', Icon: NetworkArbitrumOne },
  base: { name: 'Base', tint: '#0052FF', Icon: NetworkBase },
  op: { name: 'OP Mainnet', tint: '#FF0420', Icon: NetworkOptimism },
  matic: { name: 'Polygon', tint: '#8247E5', Icon: NetworkPolygon },
  pol: { name: 'Polygon', tint: '#8247E5', Icon: NetworkPolygon },
  bsc: { name: 'BNB Chain', tint: '#F0B90B', Icon: NetworkBinanceSmartChain },
  avax: { name: 'Avalanche', tint: '#E84142', Icon: NetworkAvalanche },
  xdai: { name: 'Gnosis', tint: '#3E6957', Icon: NetworkGnosis },
  scrl: { name: 'Scroll', tint: '#FFEEDA', Icon: NetworkScroll },
  linea: { name: 'Linea', tint: '#61DFFF', Icon: NetworkLinea },
  era: { name: 'zkSync Era', tint: '#8C8DFC', Icon: NetworkZksync },
  blast: { name: 'Blast', tint: '#FCFC03', Icon: NetworkBlast },
  mnt: { name: 'Mantle', tint: '#65B3AE', Icon: NetworkMantle },
  celo: { name: 'Celo', tint: '#FCFF52', Icon: NetworkCelo },
  ftm: { name: 'Fantom', tint: '#1969FF', Icon: NetworkFantom },
  sonic: { name: 'Sonic', tint: '#FE9A4C', Icon: NetworkSonic },
  bera: { name: 'Berachain', tint: '#814625', Icon: NetworkBerachain },
  hyper: { name: 'Hyperliquid', tint: '#97FCE4', Icon: NetworkHyperEvm },
  uni: { name: 'Unichain', tint: '#FF007A', Icon: NetworkUnichain },
  sol: { name: 'Solana', tint: '#14F195', Icon: NetworkSolana },
  tron: { name: 'Tron', tint: '#EB0029', Icon: NetworkTron },
  btc: { name: 'Bitcoin', tint: '#F7931A', Icon: NetworkBitcoin },
};

/** What this slug is called, for anywhere that needs the word rather than the mark */
export function networkName(slug: string | null | undefined): string | null {
  return slug ? (NETWORKS[slug.toLowerCase()]?.name ?? null) : null;
}

/**
 * The network, as a mark set on the text like an exponent.
 *
 * It used to sit inline, ahead of the name, at the size of a token logo — and
 * at that size next to a ticker it reads as the token's own logo, which is the
 * one thing it must never be mistaken for. So it is small, it is tucked into
 * the top-right corner of the word, and it overlaps it slightly: a mark that
 * belongs TO the text rather than standing beside it as a peer. The ring in the
 * card's own colour is what keeps it legible where it overlaps.
 *
 * The name comes on hover from `.chain-tip`, not from `title`: the native one
 * waits a second, is styled by the operating system, and shows a finger
 * nothing at all.
 *
 * An unknown slug renders nothing at all. A grey dot with a question mark would
 * be noise on precisely the networks we have not taught it yet.
 */
export function ChainBadge({ network }: { network: string | null | undefined }) {
  const chain = network ? NETWORKS[network.toLowerCase()] : undefined;
  if (!chain) return null;
  const { Icon, name, tint } = chain;
  return (
    <span
      className="chain-tip"
      data-chain={name}
      aria-label={name}
      style={{
        position: 'absolute',
        top: -5,
        right: -3,
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: `color-mix(in srgb, ${tint} 20%, var(--surf2))`,
        border: '1px solid var(--surf2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'help',
      }}
    >
      <Icon size={12} variant="branded" />
    </span>
  );
}

/**
 * What a badged word sits in: relative, so the mark can be placed on its
 * corner, with room on the right so the mark does not collide with whatever
 * follows.
 */
export function badgedText(hasBadge: boolean): CSSProperties {
  return {
    position: 'relative',
    display: 'inline-block',
    // A grid item stretches to its column by default, and the mark is placed
    // against this box's right edge — left alone it would fly off to the far
    // side of the column instead of sitting on the word
    justifySelf: 'start',
    minWidth: 0,
    paddingRight: hasBadge ? 10 : 0,
  };
}
