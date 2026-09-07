/**
 * The kitchen-sink demo: every block kind, every state, straight from the
 * design canvas. This is canned data only — the /demo route feeds it to the
 * real shell and renderer, so what the demo shows is what the wire will look
 * like, not a parallel implementation.
 *
 * Values and wording are the canvas text verbatim (typography included:
 * U+2212 minus, U+2026 ellipsis, U+00B7 middle dot). Change the canvas first,
 * then this file.
 */
import type { ChatItem, Conversation, PortfolioRef } from '../app/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function kitchenSink(): Conversation {
  const items: ChatItem[] = [
    { id: 'd01', role: 'user', text: 'What changed this week?' },
    {
      id: 'd02',
      role: 'agent',
      blocks: [
        {
          kind: 'text',
          text: 'Up $7,522 (+6.05%) over 7 days. Almost all of it is ETH price — your positions themselves barely moved.',
        },
        {
          kind: 'stats',
          items: [
            { label: 'TOTAL VALUE', value: '$131,902', sub: '+6.05% · 7D', tone: 'up' },
            { label: 'CLAIMABLE', value: '$612', sub: '+$88 · 7D', tone: 'up' },
            { label: 'DEBT', value: '−$7,800', sub: '5.8% avg APY', tone: 'mut' },
            { label: 'HEALTH FACTOR', value: '2.14', sub: '−0.12 · 7D', tone: 'down' },
          ],
        },
        {
          kind: 'chart',
          title: 'TOTAL VALUE · 7D',
          delta: '+$7,522',
          deltaTone: 'up',
          points: [
            { t: 'Aug 31', v: 123400 },
            { t: 'Sep 1', v: 125900 },
            { t: 'Sep 2', v: 128200 },
            { t: 'Sep 3', v: 126400 },
            { t: 'Sep 4', v: 129300 },
            { t: 'Sep 5', v: 130800 },
            { t: 'Sep 7', v: 131902 },
          ],
          xTicks: ['Aug 31', 'Sep 3', 'Sep 7'],
        },
        { kind: 'note', text: 'Prices as of 14:32 UTC · refreshed every 5 minutes' },
      ],
    },
    { id: 'd03', role: 'user', text: 'My riskiest position?' },
    {
      id: 'd04',
      role: 'agent',
      blocks: [
        {
          kind: 'text',
          text: 'Aave V3 on Ethereum — your only leveraged position of size. Health factor 2.14; ETH would need to fall about 53% to $1,940 before liquidation.',
        },
        {
          kind: 'table',
          columns: [
            { key: 'position', label: 'POSITION', align: 'left' },
            { key: 'supplied', label: 'SUPPLIED', align: 'right' },
            { key: 'borrowed', label: 'BORROWED', align: 'right', mobile: false },
            { key: 'health', label: 'HEALTH', align: 'right' },
            { key: 'liq', label: 'LIQ. PRICE', align: 'right', mobile: false },
          ],
          rows: [
            { position: 'Aave V3', supplied: '$12,600', borrowed: '−$5,200', health: '2.14', liq: '$1,940' },
            { position: 'Kamino', supplied: '$3,800', borrowed: '−$2,600', health: '3.05', liq: '$96.20' },
          ],
        },
        { kind: 'note', text: 'Health factors from on-chain data · 5-min refresh' },
      ],
    },
    { id: 'd05', role: 'user', text: 'Where is my money by chain?' },
    {
      id: 'd06',
      role: 'agent',
      blocks: [
        {
          kind: 'bars',
          items: [
            { label: 'EVM', value: '$80,460', percent: 61, sub: '61% · Ethereum, Arbitrum, Base · 2 wallets' },
            { label: 'Solana', value: '$43,528', percent: 33, sub: '33% · 1 wallet' },
            { label: 'Bitcoin', value: '$7,914', percent: 6, sub: '6% · 1 wallet' },
          ],
        },
        {
          kind: 'text',
          text: '61% sits on the EVM stack. Fine for the size — but every liquidation risk you carry lives there too.',
        },
      ],
    },
    { id: 'd07', role: 'user', text: 'Show me a heatmap of my LP fees' },
    {
      id: 'd08',
      role: 'agent',
      blocks: [
        // A kind the renderer does not know — exercises the unsupported path.
        { kind: 'heatmap' },
        { kind: 'text', text: "Can't draw that one yet. Same data as a table:" },
        {
          kind: 'table',
          columns: [
            { key: 'pool', label: 'POOL', align: 'left' },
            { key: 'fees', label: 'FEES · 7D', align: 'right' },
            { key: 'apr', label: 'APR', align: 'right' },
            { key: 'range', label: 'RANGE', align: 'right' },
          ],
          rows: [
            { pool: 'Uniswap V3 · ETH/USDC', fees: '$84', apr: '9.8%', range: 'in range' },
            { pool: 'GMX V2 · BTC/USDC', fees: '$21', apr: '6.1%', range: 'in range' },
            { pool: 'Orca · SOL/USDC', fees: '$0', apr: '0%', range: 'out of range' },
          ],
        },
      ],
    },
    { id: 'd09', role: 'note', text: 'Live numbers unavailable right now — answering generally.' },
    { id: 'd10', role: 'user', text: 'Explain my health factor' },
    {
      id: 'd11',
      role: 'agent',
      blocks: [
        {
          kind: 'text',
          text:
            'Health factor = collateral value × liquidation threshold ÷ debt.\n\n' +
            "Above 1.0 you're safe; at 1.0 the protocol starts selling your collateral. " +
            'Yours was last seen at 2.14 — about 2× headroom. It moves with ETH price, not with time.',
        },
      ],
    },
    { id: 'd12', role: 'user', text: 'Add these to a new portfolio: 0x7bfee9…c060, 9xQeWv…3nMk, TQm4…z9Lk' },
    {
      id: 'd13',
      role: 'agent',
      blocks: [
        { kind: 'text', text: 'Found 3 addresses on 3 networks. Create a portfolio with them?' },
        {
          kind: 'confirm',
          state: 'pending',
          title: 'Create a portfolio with 3 wallets?',
          addresses: [
            { address: '0x7bfee9…c060', chain: 'EVM' },
            { address: '9xQeWv…3nMk', chain: 'SOLANA' },
            { address: 'TQm4…z9Lk', chain: 'TRON' },
          ],
        },
      ],
    },
    { id: 'd14', role: 'user', text: 'Create portfolio' },
    {
      id: 'd15',
      role: 'agent',
      blocks: [
        {
          kind: 'confirm',
          state: 'created',
          title: 'Portfolio 2',
          portfolioName: 'Portfolio 2',
          portfolioUrl: '/p/portfolio-2',
          addresses: [
            { address: '0x7bfee9…c060', chain: 'EVM', outcome: 'added' },
            { address: '9xQeWv…3nMk', chain: 'SOLANA', outcome: 'added' },
            { address: 'TQm4…z9Lk', chain: 'TRON', outcome: 'refused', reason: 'invalid TRON checksum' },
          ],
          summary: '2 added · 1 refused',
        },
        {
          kind: 'text',
          text: 'Named it Portfolio 2 — rename it any time. The TRON address failed its checksum; paste it again if that was a typo.',
        },
      ],
    },
    { id: 'd16', role: 'user', text: 'One more with bc1qar0s…5mdq' },
    {
      id: 'd17',
      role: 'agent',
      blocks: [
        { kind: 'text', text: 'One Bitcoin address. Create a second portfolio?' },
        {
          kind: 'confirm',
          state: 'pending',
          title: 'Create a portfolio with 1 wallet?',
          addresses: [{ address: 'bc1qar0s…5mdq', chain: 'BITCOIN' }],
        },
      ],
    },
    { id: 'd18', role: 'user', text: 'Cancel' },
    {
      id: 'd19',
      role: 'agent',
      blocks: [
        // Declined renders as one quiet line — the title carries it.
        { kind: 'confirm', state: 'declined', title: 'Okay — nothing was created.', addresses: [] },
      ],
    },
    { id: 'd20', role: 'user', text: "What's my claimable total right now?" },
    { id: 'd21', role: 'note', text: 'Session expired.' },
    {
      id: 'd22',
      role: 'agent',
      blocks: [
        {
          kind: 'signin',
          title: 'Sign in to see your portfolio',
          sub: 'Portfolio answers need your account. General DeFi questions work without it.',
          pendingQuestion: "What's my claimable total right now?",
        },
      ],
    },
    { id: 'd23', role: 'note', text: 'Rate limited — retry in 27s.', retryAfterS: 27 },
    { id: 'd24', role: 'note', text: 'The agent is unavailable right now. Your question is saved.' },
    { id: 'd25', role: 'user', text: 'Top 3 positions by yield?' },
    { id: 'd26', role: 'status', text: 'Searching positions…' },
    { id: 'd27', role: 'status', text: 'Reading APYs…' },
  ];

  return { id: 'demo', title: 'Kitchen sink', at: Date.now(), items };
}

export function demoHistoryList(): Conversation[] {
  const now = Date.now();
  // The first entry shares kitchenSink()'s id so the rail can mark the open
  // conversation active. Offsets are computed per call: the relative dates
  // ("2h ago", "Yesterday") must hold whenever the demo is opened.
  return [
    { id: 'demo', title: 'What changed this week?', at: now - 40_000, items: [] },
    { id: 'h2', title: 'My riskiest position?', at: now - 2 * HOUR_MS, items: [] },
    { id: 'h3', title: 'Explain impermanent loss on Orca', at: now - 26 * HOUR_MS, items: [] },
    { id: 'h4', title: 'Is 5.4% borrow APY high right now?', at: now - 30 * HOUR_MS, items: [] },
    { id: 'h5', title: 'Move to a safer stable pool?', at: now - 3 * DAY_MS, items: [] },
    { id: 'h6', title: 'Which chain earns my highest fees?', at: now - 6 * DAY_MS, items: [] },
  ];
}

export function demoPortfolios(): PortfolioRef[] {
  return [
    { slug: 'main', name: 'Main portfolio', totalUsd: 131902, wallets: 4 },
    { slug: 'degen', name: 'Degen', totalUsd: 18240, wallets: 2 },
    { slug: 'cold-storage', name: 'Cold storage', totalUsd: 54100, wallets: 1 },
  ];
}
