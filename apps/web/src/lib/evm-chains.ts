/**
 * The EVM networks that get their own marketing page, and the sentences that
 * make each page its own rather than a find-and-replace of the last one. The
 * scanner needs none of this — coverage comes from the position indexes — so
 * this list is editorial: the networks people actually search for.
 *
 * `onchainChecks` marks the four networks where evm-rpc.ts really does read
 * Uniswap V3 ticks and Aave V3 health on-chain (eth, arb, base, polygon).
 * Keep it truthful: adding a network here without adding it there makes the
 * page lie.
 */
export interface EvmChain {
  slug: string;
  /** How the page talks about it */
  name: string;
  /** How people search for it, when that differs from the name */
  queryName?: string;
  /** First sentence of the lead — the one thing this chain is about */
  intro: string;
  /** The holdings sentence: named venues where confident, honest where not */
  holdings: string;
  /** FAQ answer for "which protocols are covered" */
  faqProtocols: string;
  onchainChecks: boolean;
}

export const EVM_CHAINS: EvmChain[] = [
  {
    slug: 'ethereum',
    name: 'Ethereum',
    intro: 'Ethereum is where the position shapes were invented — and where a token-list tracker misses the most.',
    holdings:
      'Aave loans wearing their health factors, Uniswap V3 ranges read from the pool itself, Lido and restaking positions, Pendle splits — the shapes Ethereum invented, counted at net value.',
    faqProtocols:
      'The big deployments — Aave, Uniswap, Lido, Pendle, Curve and the rest — come through the position indexes, and anything they see is counted; there is no per-protocol allowlist to fall off.',
    onchainChecks: true,
  },
  {
    slug: 'arbitrum',
    name: 'Arbitrum',
    intro: 'Arbitrum portfolios lean into perps, yield and leverage — positions that live inside apps, not wallets.',
    holdings:
      'GMX margin, Pendle PTs and YTs, Camelot LPs, Aave loans — counted with their reward and borrow legs, not just the tokens sitting on top.',
    faqProtocols:
      'GMX, Pendle, Camelot, Aave and the other Arbitrum staples come through the position indexes; new venues appear as the indexes add them.',
    onchainChecks: true,
  },
  {
    slug: 'base',
    name: 'Base',
    intro: 'Base filled up fast — and mostly with positions, not idle tokens.',
    holdings:
      'Aerodrome LPs with their gauge rewards, Morpho vaults, Moonwell loans — the Base staples, each carrying its supply, reward and borrow legs.',
    faqProtocols:
      'Aerodrome, Morpho, Moonwell and the majors’ Base deployments come through the position indexes; anything they see is counted.',
    onchainChecks: true,
  },
  {
    slug: 'optimism',
    name: 'OP Mainnet',
    queryName: 'Optimism',
    intro: 'OP Mainnet holdings tend to be LPs, locks and incentives — exactly what balance checkers undercount.',
    holdings:
      'Velodrome LPs and locks, the majors’ OP deployments, incentive rewards — counted inside each position rather than sprinkled on top of the total.',
    faqProtocols:
      'Velodrome and the major cross-chain deployments come through the position indexes; anything they see is counted.',
    onchainChecks: false,
  },
  {
    slug: 'bnb-chain',
    name: 'BNB Chain',
    intro: 'BNB Chain runs on lending and farm positions — svinooh’s own public demo portfolio is mostly Venus and Lista.',
    holdings:
      'PancakeSwap farms, Venus lending, Lista DAO — literally the kinds of positions svinooh’s demo portfolio carries in production, legs and all.',
    faqProtocols:
      'PancakeSwap, Venus, Lista DAO and the rest of the BNB staples come through the position indexes.',
    onchainChecks: false,
  },
  {
    slug: 'polygon',
    name: 'Polygon',
    intro: 'Polygon portfolios are long-lived — old Aave loans, old LPs — and deserve a tracker that still counts them.',
    holdings:
      'Aave deployments, QuickSwap LPs and the accumulated positions of a chain that has been around — at net value, with debt subtracted.',
    faqProtocols: 'Aave, QuickSwap and the major cross-chain deployments come through the position indexes.',
    onchainChecks: true,
  },
  {
    slug: 'avalanche',
    name: 'Avalanche',
    intro: 'Avalanche DeFi never left — it just stopped being loud.',
    holdings:
      'LFJ (Trader Joe) LPs, Benqi lending and staking, GMX on Avalanche — with reward legs, borrow legs and health factors where they apply.',
    faqProtocols: 'LFJ, Benqi, GMX and the major deployments come through the position indexes.',
    onchainChecks: false,
  },
  {
    slug: 'berachain',
    name: 'Berachain',
    intro: 'Berachain’s whole design pushes money into positions — proof-of-liquidity only works if your liquidity is somewhere.',
    holdings:
      'Kodiak LPs, Infrared vaults and the rest of the proof-of-liquidity flywheel — counted while it spins, rewards inside each position.',
    faqProtocols:
      'The Berachain natives — Kodiak, Infrared and company — come through the position indexes as they see them; coverage grows with the chain.',
    onchainChecks: false,
  },
  {
    slug: 'zksync',
    name: 'zkSync Era',
    queryName: 'zkSync',
    intro: 'zkSync Era balances scatter across native venues that generic trackers index late.',
    holdings:
      'SyncSwap LPs, the chain’s native venues and the majors’ deployments — whatever the position indexes see, counted at net value.',
    faqProtocols:
      'SyncSwap and the chain’s venues come through the position indexes; coverage is theirs, not a hand-kept list.',
    onchainChecks: false,
  },
  {
    slug: 'linea',
    name: 'Linea',
    intro: 'Linea positions ride incentive programs — the kind of value that lives in apps, not wallets.',
    holdings:
      'The majors’ Linea deployments and the chain’s native venues, with incentive rewards counted inside each position rather than lost.',
    faqProtocols:
      'Coverage comes from the position indexes rather than a per-chain list — major deployments and local venues appear as the indexes see them.',
    onchainChecks: false,
  },
  {
    slug: 'scroll',
    name: 'Scroll',
    intro: 'Scroll kept its head down and its DeFi small and real — small positions still deserve honest counting.',
    holdings:
      'The majors’ Scroll deployments and the chain’s own venues — whatever the position indexes see, with legs and net values like everywhere else.',
    faqProtocols:
      'Coverage comes from the position indexes rather than a per-chain list — deployments appear as the indexes add them.',
    onchainChecks: false,
  },
  {
    slug: 'sonic',
    name: 'Sonic',
    intro: 'Sonic inherited Fantom’s DeFi crowd and its habit of parking everything in yield.',
    holdings:
      'Yield venues that moved over from Fantom plus Sonic natives — counted as the position indexes see them, rewards and debt included.',
    faqProtocols:
      'Coverage comes from the position indexes rather than a per-chain list — Sonic venues appear as the indexes add them.',
    onchainChecks: false,
  },
];

export const evmChain = (slug: string) => EVM_CHAINS.find((c) => c.slug === slug);
