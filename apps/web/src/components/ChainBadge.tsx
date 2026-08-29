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
import type { ComponentType } from 'react';

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
  Icon: ComponentType<{ size?: number; variant?: 'mono' | 'branded' | 'background' }>;
}

const NETWORKS: Record<string, Network> = {
  eth: { name: 'Ethereum', Icon: NetworkEthereum },
  arb: { name: 'Arbitrum', Icon: NetworkArbitrumOne },
  base: { name: 'Base', Icon: NetworkBase },
  op: { name: 'OP Mainnet', Icon: NetworkOptimism },
  matic: { name: 'Polygon', Icon: NetworkPolygon },
  pol: { name: 'Polygon', Icon: NetworkPolygon },
  bsc: { name: 'BNB Chain', Icon: NetworkBinanceSmartChain },
  avax: { name: 'Avalanche', Icon: NetworkAvalanche },
  xdai: { name: 'Gnosis', Icon: NetworkGnosis },
  scrl: { name: 'Scroll', Icon: NetworkScroll },
  linea: { name: 'Linea', Icon: NetworkLinea },
  era: { name: 'zkSync Era', Icon: NetworkZksync },
  blast: { name: 'Blast', Icon: NetworkBlast },
  mnt: { name: 'Mantle', Icon: NetworkMantle },
  celo: { name: 'Celo', Icon: NetworkCelo },
  ftm: { name: 'Fantom', Icon: NetworkFantom },
  sonic: { name: 'Sonic', Icon: NetworkSonic },
  bera: { name: 'Berachain', Icon: NetworkBerachain },
  hyper: { name: 'Hyperliquid', Icon: NetworkHyperEvm },
  uni: { name: 'Unichain', Icon: NetworkUnichain },
  sol: { name: 'Solana', Icon: NetworkSolana },
  tron: { name: 'Tron', Icon: NetworkTron },
  btc: { name: 'Bitcoin', Icon: NetworkBitcoin },
};

/** What this slug is called, for anywhere that needs the word rather than the mark */
export function networkName(slug: string | null | undefined): string | null {
  return slug ? (NETWORKS[slug.toLowerCase()]?.name ?? null) : null;
}

/**
 * The mark beside a protocol or a holding.
 *
 * `branded`, drawn on nothing.
 *
 * The other two variants were tried and both are worse here. `background` is
 * the uniform one — a full-bleed tile in the brand colour, which clipped round
 * would have made every network the same chip — but the set draws Base's glyph
 * in it as a plain white square, and a logo we render wrongly is the exact
 * thing hand-drawn approximations were replaced to avoid. `mono` flattens each
 * mark to one colour, and colour is most of what tells Base from Arbitrum at
 * this size.
 *
 * So: each network as its owner draws it. Ethereum's bare diamond next to
 * Base's rounded square is not a set, and that is the honest cost — every mark
 * in the set carries its own padding inside the viewBox, so at least they share
 * a footprint and a column of them still lines up.
 *
 * `title` rather than a built tooltip: the name is a footnote for the one person
 * who does not recognise the mark, and a hover card would be a component, a
 * portal and a mobile question for a word.
 *
 * An unknown slug renders nothing at all. A grey disc with a question mark
 * would be a row of noise on precisely the networks we have not taught it yet,
 * and the row already says everything it needs to without one.
 */
export function ChainBadge({ network, size = 18 }: { network: string | null | undefined; size?: number }) {
  const chain = network ? NETWORKS[network.toLowerCase()] : undefined;
  if (!chain) return null;
  const { Icon, name } = chain;
  return (
    <span
      title={name}
      aria-label={name}
      style={{ display: 'inline-flex', flexShrink: 0, cursor: 'help', lineHeight: 0 }}
    >
      <Icon size={size} variant="branded" />
    </span>
  );
}
